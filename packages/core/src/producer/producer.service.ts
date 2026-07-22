import { JobStatus } from '../jobs/job-state.enum.js';
import { PortQueueEvent } from '../events/event-name.enum.js';
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

    // Scheduling mode: create/update a recurring definition instead of a one-off insert.
    if (isRecurring) {
      const result = await this.upsertSchedule(queue, opts);
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
      preferredInstanceKey: affinity.preferredInstanceKey,
      preferredInstanceKeyPattern: affinity.preferredInstanceKeyPattern,
      fallbackInstanceKey: affinity.fallbackInstanceKey,
      fallbackInstanceKeyPattern: affinity.fallbackInstanceKeyPattern,
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
          void this.notifier.notifyJobAdded(queue);
        });
      } else if (!opts.tx) {
        this.runtime.wakeup.signal(queue);
        void this.notifier.notifyJobAdded(queue);
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
   * Validate and normalize the multi-instance affinity options. Affinity is only meaningful when
   * this PortQueue declared an `instanceKey`; a job may target instances by exact key or by regex
   * pattern, but never both for the same role.
   */
  private resolveAffinity(
    queue: string,
    opts: AddJobOptions<unknown>,
  ): {
    preferredInstanceKey: string | null;
    preferredInstanceKeyPattern: string | null;
    fallbackInstanceKey: string | null;
    fallbackInstanceKeyPattern: string | null;
  } {
    const { preferredInstanceKey, preferredInstanceKeyPattern } = opts;
    const { fallbackInstanceKey, fallbackInstanceKeyPattern } = opts;
    const any =
      preferredInstanceKey != null ||
      preferredInstanceKeyPattern != null ||
      fallbackInstanceKey != null ||
      fallbackInstanceKeyPattern != null;
    if (any && !this.runtime.instanceKey) {
      throw new InvalidOptionsError(
        `Job on queue '${queue}' sets instance affinity (preferred/fallbackInstanceKey), but this ` +
          `PortQueue is not in multi-instance mode. Pass an \`instanceKey\` to the PortQueue ` +
          `constructor to enable it.`,
        { queue },
      );
    }
    this.validateAffinityRole(queue, 'preferred', preferredInstanceKey, preferredInstanceKeyPattern);
    this.validateAffinityRole(queue, 'fallback', fallbackInstanceKey, fallbackInstanceKeyPattern);
    return {
      preferredInstanceKey: preferredInstanceKey ?? null,
      preferredInstanceKeyPattern: preferredInstanceKeyPattern ?? null,
      fallbackInstanceKey: fallbackInstanceKey ?? null,
      fallbackInstanceKeyPattern: fallbackInstanceKeyPattern ?? null,
    };
  }

  /** A role (preferred/fallback) takes an exact key XOR a valid regex pattern, not both. */
  private validateAffinityRole(
    queue: string,
    role: 'preferred' | 'fallback',
    key: string | undefined,
    pattern: string | undefined,
  ): void {
    if (key != null && pattern != null) {
      throw new InvalidOptionsError(
        `Job on queue '${queue}' sets both '${role}InstanceKey' and '${role}InstanceKeyPattern' — provide exactly one.`,
        { queue },
      );
    }
    if (pattern != null) {
      try {
        new RegExp(pattern);
      } catch (err) {
        throw new InvalidOptionsError(
          `Job on queue '${queue}' has an invalid '${role}InstanceKeyPattern' regular expression: ${String(err)}`,
          { queue },
        );
      }
    }
  }

  private async upsertSchedule<TData>(
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
    // Keyless API: the recurrence IS the identity. Re-adding the same cron+timezone (or the same
    // interval) on a queue updates that schedule; a different recurrence makes a new one.
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
    };
    const existing = (await driver.listSchedules({ queueName: queue })).find((s) =>
      cron ? s.cron === cron.pattern && s.timezone === cron.tz : s.everyMs === everyMs,
    );
    const saved = await driver.upsertSchedule({
      schedule: newSchedule,
      ...(opts.tx ? { tx: opts.tx } : {}),
    });
    events.emit(existing ? PortQueueEvent.SCHEDULE_UPDATED : PortQueueEvent.SCHEDULE_CREATED, {
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
    }));
  }
}

/** Normalize a {@link CronSpec} (string or `{ pattern, tz }`) to a pattern + IANA tz. */
function normalizeCron(cron: CronSpec): { pattern: string; tz: string } {
  if (typeof cron === 'string') return { pattern: cron, tz: 'UTC' };
  return { pattern: cron.pattern, tz: cron.tz ?? 'UTC' };
}
