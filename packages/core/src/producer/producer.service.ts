import { JobStatus } from '../jobs/job-state.enum.js';
import { PortQueueEvent } from '../events/event-name.enum.js';
import { DeduplicationReason } from '../options/enums.js';
import { InvalidOptionsError, PayloadTooLargeError, QueuePausedError } from '../errors/errors.js';
import { toMs } from '../util/duration.js';
import { uuid } from '../util/uuid.js';
import { CronExpression } from '../scheduling/cron.js';
import type { AddJobOptions, CronSpec } from '../options/job-options.js';
import type { AddJobResult, ScheduleInfo } from './results.js';
import type { NewJobRecord, NewScheduleRow } from '../jobs/job-record.js';
import type { Runtime } from '../client/runtime.js';
import type { NotifierService } from '../pubsub/notifier.service.js';

/**
 * Insert/dedup/schedule logic behind the Queue handle.
 */
export class ProducerService {
  constructor(
    private readonly runtime: Runtime,
    private readonly notifier: NotifierService,
  ) {}

  async addJob<TData>(queue: string, options: AddJobOptions<TData>): Promise<AddJobResult> {
    const { registry, resolver, clock, driver, events, hooks } = this.runtime;
    const merged = await hooks.runBeforeAdd(queue, options as AddJobOptions<unknown>);
    const opts = merged as AddJobOptions<TData>;

    const isRecurring = opts.startEvery != null || opts.cron != null;
    if (isRecurring && opts.startAfter != null) {
      throw new InvalidOptionsError(
        `Cannot combine 'startAfter' with a recurring 'startEvery'/'cron' on queue '${queue}'. ` +
          `'startAfter' delays a one-off job; recurring modes schedule repeated runs.`,
        { queue },
      );
    }

    // Payload size guard.
    const queueOptions = registry.getOptions(queue);
    const maxBytes = queueOptions.maxPayloadBytes ?? this.runtime.maxPayloadBytes;
    const serialized = opts.data === undefined ? 'null' : JSON.stringify(opts.data);
    const size = Buffer.byteLength(serialized, 'utf8');
    if (size > maxBytes) throw new PayloadTooLargeError(queue, size, maxBytes);

    // Idempotency dedup spans BOTH the job and schedule tables, is queue-scoped, and applies to
    // one-off and recurring adds alike — but only when a key is given. First writer wins: a later
    // add with the same key returns the existing job or schedule instead of creating anything new,
    // even when the two adds differ in shape (e.g. a plain job matching a recurring schedule).
    if (opts.idempotencyKey != null) {
      const dup = await this.findIdempotencyDuplicate(queue, opts.idempotencyKey, opts.tx);
      if (dup) {
        // Only a job match carries a jobId the JOB_ADDED event needs; a schedule match is silent.
        if (dup.jobId != null) {
          events.emit(PortQueueEvent.JOB_ADDED, { jobId: dup.jobId, queue, deduplicated: true });
        }
        await hooks.runAfterAdd(queue, dup);
        return dup;
      }
    }

    // Scheduling mode: create a recurring definition instead of a one-off insert.
    if (isRecurring) {
      const result = await this.createSchedule(queue, opts);
      await hooks.runAfterAdd(queue, result);
      return result;
    }

    const row = await registry.ensure(queue);
    if (row.acceptingPaused) throw new QueuePausedError(queue);

    const affinity = this.resolveAffinity(queue, opts);

    const now = clock.now();
    const resolved = resolver.resolve({
      job: opts,
      ...(queueOptions.defaultJobOptions ? { queueDefaults: queueOptions.defaultJobOptions } : {}),
      ...(queueOptions.retention ? { queueRetention: queueOptions.retention } : {}),
      now,
    });

    const steps = registry.getWorkflowSteps(queue);
    let workflowId: string | null = null;
    let workflowStepKey: string | null = null;
    if (steps && steps.length > 0) {
      workflowId = uuid();
      workflowStepKey = opts.startStep ?? steps[0]!.key;
      if (!steps.some((s) => s.key === workflowStepKey)) {
        throw new InvalidOptionsError(
          `startStep '${workflowStepKey}' is not a declared step of workflow queue '${queue}'.`,
          { queue },
        );
      }
    }

    const job: NewJobRecord = {
      queueName: queue,
      status: JobStatus.PENDING,
      priority: resolved.priority,
      data: opts.data,
      metadata: resolved.metadata,
      startAfter: resolved.startAfter,
      expireAt: resolved.expireAt,
      retryAttempt: 0,
      retryMaxAttempts: resolved.retryMaxAttempts,
      retryDelayMs: resolved.retryDelayMs,
      retryBackoff: resolved.retryBackoff,
      retryBackoffFactor: resolved.retryBackoffFactor,
      retryMaxDelayMs: resolved.retryMaxDelayMs,
      retryJitter: resolved.retryJitter,
      retentionMode: resolved.retentionMode,
      retentionTtlMs: resolved.retentionTtlMs,
      idempotencyKey: resolved.idempotencyKey,
      scheduleId: null,
      singletonKey: resolved.singletonKey,
      workflowId,
      workflowStepKey,
      preferredInstanceKeyPattern: affinity.preferredInstanceKeyPattern,
      createdAt: now,
    };

    const inserted = await driver.insertJob({ job, ...(opts.tx ? { tx: opts.tx } : {}) });

    const result: AddJobResult = {
      jobId: inserted.id,
      queue,
      status: inserted.status,
      startAfter: new Date(inserted.startAfter),
      deduplicated: inserted.deduplicated,
      ...(inserted.deduplicationReason
        ? { deduplicationReason: inserted.deduplicationReason }
        : {}),
      ...(inserted.workflowId ? { workflowId: inserted.workflowId } : {}),
    };

    // Fire the wakeup + NOTIFY only when not deduped. With a tx, defer NOTIFY to commit.
    if (!inserted.deduplicated) {
      if (opts.tx?.onCommit) {
        opts.tx.onCommit(() => {
          this.runtime.wakeup.signal(queue);
          void this.notifier.notifyJobAdded(queue, job.preferredInstanceKeyPattern);
        });
      } else if (!opts.tx) {
        this.runtime.wakeup.signal(queue);
        void this.notifier.notifyJobAdded(queue, job.preferredInstanceKeyPattern);
      }
      events.emit(PortQueueEvent.JOB_ADDED, { jobId: inserted.id, queue, deduplicated: false });
    } else {
      events.emit(PortQueueEvent.JOB_ADDED, { jobId: inserted.id, queue, deduplicated: true });
    }

    await hooks.runAfterAdd(queue, result);
    return result;
  }

  async addJobs<TData>(queue: string, jobs: AddJobOptions<TData>[]): Promise<AddJobResult[]> {
    const results: AddJobResult[] = [];
    for (const job of jobs) results.push(await this.addJob(queue, job));
    return results;
  }

  /**
   * Validate and normalize the multi-instance affinity option. Affinity is only meaningful when
   * this PortQueue declared an `instanceKey`; a job targets instances by a single regex pattern.
   */
  private resolveAffinity(
    queue: string,
    opts: AddJobOptions<unknown>,
  ): {
    preferredInstanceKeyPattern: string | null;
  } {
    const { preferredInstanceKeyPattern } = opts;
    if (preferredInstanceKeyPattern != null && !this.runtime.instanceKey) {
      throw new InvalidOptionsError(
        `Job on queue '${queue}' sets 'preferredInstanceKeyPattern', but this PortQueue is not in ` +
          `multi-instance mode. Pass an \`instanceKey\` to the PortQueue constructor to enable it.`,
        { queue },
      );
    }
    if (preferredInstanceKeyPattern != null) {
      try {
        new RegExp(preferredInstanceKeyPattern);
      } catch (err) {
        throw new InvalidOptionsError(
          `Job on queue '${queue}' has an invalid 'preferredInstanceKeyPattern' regular expression: ${String(err)}`,
          { queue },
        );
      }
    }
    return { preferredInstanceKeyPattern: preferredInstanceKeyPattern ?? null };
  }

  /**
   * The unified idempotency lookup behind {@link addJob}. Checks the schedule table then the job
   * table for this queue+key; at most one can exist (first writer wins across both). Returns a
   * deduplicated result shaped for whichever entity matched, or null when the key is free.
   */
  private async findIdempotencyDuplicate(
    queue: string,
    idempotencyKey: string,
    tx?: AddJobOptions<unknown>['tx'],
  ): Promise<AddJobResult | null> {
    const { driver } = this.runtime;
    const schedule = await driver.findScheduleByIdempotencyKey({
      queueName: queue,
      idempotencyKey,
      ...(tx ? { tx } : {}),
    });
    if (schedule) {
      return {
        queue,
        scheduleId: schedule.id,
        nextRunAt: schedule.nextRunAt != null ? new Date(schedule.nextRunAt) : null,
        deduplicated: true,
        deduplicationReason: DeduplicationReason.IDEMPOTENCY,
      };
    }
    const job = await driver.findJobByIdempotencyKey({
      queueName: queue,
      idempotencyKey,
      ...(tx ? { tx } : {}),
    });
    if (job) {
      return {
        jobId: job.id,
        queue,
        status: job.status,
        startAfter: new Date(job.startAfter),
        deduplicated: true,
        deduplicationReason: DeduplicationReason.IDEMPOTENCY,
        ...(job.workflowId ? { workflowId: job.workflowId } : {}),
      };
    }
    return null;
  }

  private async createSchedule<TData>(
    queue: string,
    opts: AddJobOptions<TData>,
  ): Promise<AddJobResult> {
    this.validateSchedule(queue, opts);
    const { registry, driver, clock, resolver, events } = this.runtime;
    await registry.ensure(queue);
    const now = clock.now();
    const resolved = resolver.resolve({ job: opts, now });
    const cron = opts.cron != null ? normalizeCron(opts.cron) : null;
    const everyMs = opts.startEvery != null ? toMs(opts.startEvery) : null;
    // No pattern-based dedup: identical recurrences on a queue are allowed to coexist. When the
    // caller wants exactly one, they pass an idempotencyKey — that dedup ran in addJob() above, so
    // reaching here means the key was free (or absent) and we always insert a fresh schedule.
    const nextRunAt = this.computeNextRun(opts, now);

    const newSchedule: NewScheduleRow = {
      queueName: queue,
      cron: cron?.pattern ?? null,
      everyMs,
      timezone: cron?.tz ?? null,
      data: opts.data,
      priority: resolved.priority,
      retryMaxAttempts: resolved.retryMaxAttempts,
      retryDelayMs: resolved.retryDelayMs,
      nextRunAt,
      enabled: true,
      startAt: null,
      endAt: null,
      idempotencyKey: resolved.idempotencyKey,
    };
    const saved = await driver.insertSchedule({
      schedule: newSchedule,
      ...(opts.tx ? { tx: opts.tx } : {}),
    });
    events.emit(PortQueueEvent.SCHEDULE_CREATED, {
      scheduleId: saved.id,
      queue,
    });
    return {
      queue,
      scheduleId: saved.id,
      nextRunAt: saved.nextRunAt != null ? new Date(saved.nextRunAt) : null,
      deduplicated: false,
    };
  }

  private validateSchedule(queue: string, opts: AddJobOptions<unknown>): void {
    if (opts.cron != null && opts.startEvery != null) {
      throw new InvalidOptionsError(
        `A recurring job on queue '${queue}' must set exactly one of 'cron' or 'startEvery' — not both.`,
        { queue },
      );
    }
  }

  computeNextRun(opts: Pick<AddJobOptions<unknown>, 'cron' | 'startEvery'>, now: number): number {
    if (opts.cron != null) {
      const { pattern, tz } = normalizeCron(opts.cron);
      return new CronExpression(pattern, tz).next(now);
    }
    return now + toMs(opts.startEvery!);
  }

  async getSchedules(queue: string): Promise<ScheduleInfo[]> {
    await this.runtime.registry.ensure(queue);
    const rows = await this.runtime.driver.listSchedules({ queueName: queue });
    return rows.map((s) => ({
      scheduleId: s.id,
      cron: s.cron,
      every: s.everyMs,
      timezone: s.timezone,
      nextRunAt: s.nextRunAt != null ? new Date(s.nextRunAt) : null,
      lastRunAt: s.lastRunAt != null ? new Date(s.lastRunAt) : null,
      enabled: s.enabled,
      idempotencyKey: s.idempotencyKey,
    }));
  }
}

/** Normalize a {@link CronSpec} (string or `{ pattern, tz }`) to a pattern + IANA tz. */
function normalizeCron(cron: CronSpec): { pattern: string; tz: string } {
  if (typeof cron === 'string') return { pattern: cron, tz: 'UTC' };
  return { pattern: cron.pattern, tz: cron.tz ?? 'UTC' };
}
