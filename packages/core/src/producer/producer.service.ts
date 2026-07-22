import { JobStatus } from '../jobs/job-state.enum.js';
import { DeduplicationReason } from '../options/enums.js';
import { PortQueueEvent } from '../events/event-name.enum.js';
import { InvalidOptionsError, PayloadTooLargeError, QueuePausedError } from '../errors/errors.js';
import { toMs } from '../util/duration.js';
import { uuid } from '../util/uuid.js';
import { CronExpression } from '../scheduling/cron.js';
import type { AddJobOptions, ScheduleSpec } from '../options/job-options.js';
import type { AddJobResult, ScheduleInfo } from './results.js';
import type { NewJobRecord, NewScheduleRow } from '../jobs/job-record.js';
import type { Runtime } from '../client/runtime.js';
import type { NotifierService } from '../pubsub/notifier.service.js';

/**
 * Insert/dedup/schedule logic behind the Queue handle (build_plan/02.2 / 05.3).
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

    if (opts.delay != null && opts.startAfter != null) {
      throw new InvalidOptionsError(
        `Cannot set both 'delay' and 'startAfter' on a job for queue '${queue}'. Both mean "not before" — pass exactly one.`,
        { queue },
      );
    }

    // Payload size guard (build_plan/18.2).
    const queueOptions = registry.getOptions(queue);
    const maxBytes = queueOptions.maxPayloadBytes ?? this.runtime.maxPayloadBytes;
    const serialized = opts.data === undefined ? 'null' : JSON.stringify(opts.data);
    const size = Buffer.byteLength(serialized, 'utf8');
    if (size > maxBytes) throw new PayloadTooLargeError(queue, size, maxBytes);

    // Scheduling mode: create/update a recurring definition instead of a one-off insert.
    if (opts.schedule) {
      const result = await this.upsertSchedule(queue, opts);
      await hooks.runAfterAdd(queue, result);
      return result;
    }

    const row = await registry.ensure(queue);
    if (row.acceptingPaused) throw new QueuePausedError(queue);

    const now = clock.now();
    const resolved = resolver.resolve({
      job: opts,
      ...(queueOptions.defaultJobOptions ? { queueDefaults: queueOptions.defaultJobOptions } : {}),
      ...(queueOptions.retention ? { queueRetention: queueOptions.retention } : {}),
      now,
    });

    const workflow = registry.getWorkflow(queue);
    let workflowId: string | null = null;
    let workflowStepKey: string | null = null;
    if (workflow) {
      workflowId = uuid();
      workflowStepKey = opts.startStep ?? workflow.entryStep;
      if (!workflow.steps.some((s) => s.key === workflowStepKey)) {
        throw new InvalidOptionsError(
          `startStep '${workflowStepKey}' is not a declared step of workflow queue '${queue}'.`,
          { queue },
        );
      }
    }

    const job: NewJobRecord = {
      queueId: row.id,
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
      runOnInstanceId: null,
      runOnInstanceType: null,
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
        ? { deduplicationReason: inserted.deduplicationReason as DeduplicationReason }
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

  private async upsertSchedule<TData>(
    queue: string,
    opts: AddJobOptions<TData>,
  ): Promise<AddJobResult> {
    const spec = opts.schedule!;
    this.validateSchedule(queue, spec);
    const { registry, driver, clock, resolver, events } = this.runtime;
    const row = await registry.ensure(queue);
    const now = clock.now();
    const resolved = resolver.resolve({ job: opts, now });
    const nextRunAt = this.computeNextRun(spec, now);

    const newSchedule: NewScheduleRow = {
      key: spec.key,
      queueId: row.id,
      cron: spec.cron ?? null,
      everyMs: spec.every != null ? toMs(spec.every) : null,
      timezone: spec.timezone ?? null,
      data: opts.data,
      priority: resolved.priority,
      retryMaxAttempts: resolved.retryMaxAttempts,
      retryDelayMs: resolved.retryDelayMs,
      nextRunAt,
      enabled: true,
      startAt: spec.startAt ? spec.startAt.getTime() : null,
      endAt: spec.endAt ? spec.endAt.getTime() : null,
    };
    const existing = (await driver.listSchedules({ queueId: row.id })).find(
      (s) => s.key === spec.key,
    );
    const saved = await driver.upsertSchedule({
      schedule: newSchedule,
      ...(opts.tx ? { tx: opts.tx } : {}),
    });
    events.emit(existing ? PortQueueEvent.SCHEDULE_UPDATED : PortQueueEvent.SCHEDULE_CREATED, {
      scheduleId: saved.id,
      queue,
      key: spec.key,
    });
    return {
      queue,
      scheduleId: saved.id,
      nextRunAt: saved.nextRunAt != null ? new Date(saved.nextRunAt) : null,
      deduplicated: false,
    };
  }

  private validateSchedule(queue: string, spec: ScheduleSpec): void {
    const hasCron = spec.cron != null;
    const hasEvery = spec.every != null;
    if (hasCron === hasEvery) {
      throw new InvalidOptionsError(
        `A schedule for queue '${queue}' (key '${spec.key}') must set exactly one of 'cron' or 'every' — not both, not neither.`,
        { queue },
      );
    }
  }

  computeNextRun(spec: ScheduleSpec, now: number): number {
    const from = spec.startAt && spec.startAt.getTime() > now ? spec.startAt.getTime() - 1 : now;
    if (spec.cron) {
      return new CronExpression(spec.cron, spec.timezone ?? 'UTC').next(from);
    }
    return from + toMs(spec.every!);
  }

  async getSchedules(queue: string): Promise<ScheduleInfo[]> {
    const row = await this.runtime.registry.ensure(queue);
    const rows = await this.runtime.driver.listSchedules({ queueId: row.id });
    return rows.map((s) => ({
      scheduleId: s.id,
      key: s.key,
      cron: s.cron,
      every: s.everyMs,
      timezone: s.timezone,
      nextRunAt: s.nextRunAt != null ? new Date(s.nextRunAt) : null,
      lastRunAt: s.lastRunAt != null ? new Date(s.lastRunAt) : null,
      enabled: s.enabled,
      startAt: s.startAt != null ? new Date(s.startAt) : null,
      endAt: s.endAt != null ? new Date(s.endAt) : null,
    }));
  }
}
