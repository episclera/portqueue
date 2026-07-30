import { JobStatus } from '../jobs/job-state.enum';
import { PortQueueEvent } from '../events/event-name.enum';
import { DeduplicationReason } from '../options/enums';
import { InvalidOptionsError, QueuePausedError } from '../errors/errors';
import { wholeSeconds, wholeSecondsToMs } from '../util/seconds';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../constants';
import { CronExpression } from '../scheduling/cron';
import type { AddJobOptions, CronSpec, ScheduleOptions } from '../options/job-options';
import type { AddJobResult, GetSchedulesQuery, Page, ScheduleInfo } from './results';
import type { NewJobRecord, NewScheduleRow, ScheduledJobOptions } from '../jobs/job-record';
import type { Runtime } from '../client/runtime';
import type { NotifierService } from '../pubsub/notifier.service';

/**
 * Insert/dedup/schedule logic behind the producing half of `PortQueue`.
 *
 * Nothing here has a side effect a caller would not expect from its name: in particular the schedule
 * *reads* do not ensure a queue row, so listing the schedules of a name that was never used no
 * longer creates that queue.
 */
export class ProducerService {
  constructor(
    private readonly runtime: Runtime,
    private readonly notifier: NotifierService,
  ) {}

  async addJob<TData>(queue: string, options: AddJobOptions<TData>): Promise<AddJobResult> {
    const { registry, clock, driver, events, hooks } = this.runtime;
    const merged = await hooks.runBeforeAdd(queue, options as AddJobOptions<unknown>);
    const opts = merged as AddJobOptions<TData>;

    if (opts.schedule) this.rejectUnknownScheduleKeys(queue, opts.schedule);

    const isRecurring = opts.schedule?.startEverySeconds != null || opts.schedule?.cron != null;
    if (isRecurring && opts.schedule?.startAfterSeconds != null) {
      throw new InvalidOptionsError(
        `Cannot combine 'schedule.startAfterSeconds' with a recurring ` +
          `'schedule.startEverySeconds'/'schedule.cron' on queue '${queue}'. ` +
          `A start delay applies to a one-off job; recurring modes schedule repeated runs.`,
        { queue },
      );
    }

    const queueOptions = registry.getOptions(queue);

    // Idempotency dedup is queue-scoped and per-entity: a one-off add (no recurring options)
    // dedups against the jobs table; a recurring add dedups against the schedule table. Each key is
    // unique only within its own entity's table, so a one-off job and a schedule may share a key
    // without colliding. First writer wins within that table — a later add with the same key
    // returns the existing entity instead of creating a new one. (Jobs a schedule produces are
    // never stamped with the key, so a recurring schedule keeps producing every run.)
    if (opts.idempotencyKey != null) {
      const dup = await this.findIdempotencyDuplicate(
        queue,
        opts.idempotencyKey,
        isRecurring,
        opts.tx,
      );
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

    const now = clock.now();
    const job = this.buildJob(queue, opts, queueOptions, now);
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
    };

    if (!inserted.deduplicated) {
      this.announce(queue, [job.preferredInstanceKeyPattern], opts.tx);
    }
    events.emit(PortQueueEvent.JOB_ADDED, {
      jobId: inserted.id,
      queue,
      deduplicated: inserted.deduplicated,
    });

    await hooks.runAfterAdd(queue, result);
    return result;
  }

  /**
   * Add many one-off jobs to one queue in a **single** insert.
   *
   * This is the batch path `Driver.insertJobs` exists for: one dedup lookup and one multi-row insert
   * for the whole set, rather than the two round trips per job a loop over {@link addJob} costs.
   *
   * Recurring options are rejected here rather than silently ignored — a batch of schedules is a
   * different operation, and each recurrence needs its own `addJob` so its result carries a
   * `scheduleId`. BEFORE_ADD/AFTER_ADD hooks still run per job, in order, exactly as they do for a
   * single add.
   */
  async addJobs<TData>(queue: string, jobs: Array<AddJobOptions<TData>>): Promise<AddJobResult[]> {
    const { registry, clock, driver, events, hooks } = this.runtime;
    if (!jobs.length) return [];

    const prepared: Array<AddJobOptions<TData>> = [];
    for (const options of jobs) {
      const opts = (await hooks.runBeforeAdd(
        queue,
        options as AddJobOptions<unknown>,
      )) as AddJobOptions<TData>;
      if (opts.schedule) this.rejectUnknownScheduleKeys(queue, opts.schedule);
      if (opts.schedule?.startEverySeconds != null || opts.schedule?.cron != null) {
        throw new InvalidOptionsError(
          `addJobs on queue '${queue}' cannot create recurring jobs: one of the entries sets ` +
            `'schedule.cron'/'schedule.startEverySeconds'. Add each recurrence with addJob, whose ` +
            `result carries the scheduleId a batch insert has no place to return.`,
          { queue },
        );
      }
      prepared.push(opts);
    }

    // One transaction has to be shared by every entry, so a batch cannot mix caller transactions.
    const tx = prepared.find((opts) => opts.tx)?.tx;
    if (tx && prepared.some((opts) => opts.tx && opts.tx !== tx)) {
      throw new InvalidOptionsError(
        `addJobs on queue '${queue}' received more than one distinct 'tx'. A batch is one insert, ` +
          `so every entry must share the same transaction (or none of them set one).`,
        { queue },
      );
    }

    const row = await registry.ensure(queue);
    if (row.acceptingPaused) throw new QueuePausedError(queue);

    const now = clock.now();
    const queueOptions = registry.getOptions(queue);
    const records = prepared.map((opts) => this.buildJob(queue, opts, queueOptions, now));
    const inserted = await driver.insertJobs({ jobs: records, ...(tx ? { tx } : {}) });

    const results: AddJobResult[] = inserted.map((entry) => ({
      jobId: entry.id,
      queue,
      status: entry.status,
      startAfter: new Date(entry.startAfter),
      deduplicated: entry.deduplicated,
      ...(entry.deduplicationReason ? { deduplicationReason: entry.deduplicationReason } : {}),
    }));

    const freshPatterns = records
      .filter((_, index) => !inserted[index]!.deduplicated)
      .map((record) => record.preferredInstanceKeyPattern);
    if (freshPatterns.length) this.announce(queue, freshPatterns, tx);

    for (const result of results) {
      events.emit(PortQueueEvent.JOB_ADDED, {
        jobId: result.jobId!,
        queue,
        deduplicated: result.deduplicated,
      });
    }
    for (const result of results) await hooks.runAfterAdd(queue, result);
    return results;
  }

  /** Resolve one job's options into the row to insert. */
  private buildJob<TData>(
    queue: string,
    opts: AddJobOptions<TData>,
    queueOptions: ReturnType<Runtime['registry']['getOptions']>,
    now: number,
  ): NewJobRecord {
    const affinity = this.resolveAffinity(queue, opts as AddJobOptions<unknown>);
    const resolved = this.runtime.resolver.resolve({
      job: opts,
      ...(queueOptions.defaultJobOptions ? { queueDefaults: queueOptions.defaultJobOptions } : {}),
      ...(queueOptions.retention ? { queueRetention: queueOptions.retention } : {}),
      ...(opts.schedule?.startAfterSeconds != null
        ? { startAfterSeconds: opts.schedule.startAfterSeconds }
        : {}),
      now,
    });
    return {
      queueName: queue,
      status: JobStatus.PENDING,
      priority: resolved.priority,
      data: opts.data,
      startAfter: resolved.startAfter,
      expireAt: resolved.expireAt,
      retryAttempt: 0,
      retryMaxAttempts: resolved.retryMaxAttempts,
      retryDelaySeconds: resolved.retryDelaySeconds,
      retryBackoff: resolved.retryBackoff,
      retryBackoffFactor: resolved.retryBackoffFactor,
      retryMaxDelaySeconds: resolved.retryMaxDelaySeconds,
      retryJitter: resolved.retryJitter,
      retentionMode: resolved.retentionMode,
      retentionTtlSeconds: resolved.retentionTtlSeconds,
      retentionStatuses: resolved.retentionStatuses,
      idempotencyKey: resolved.idempotencyKey,
      scheduleId: null,
      singletonKey: resolved.singletonKey,
      preferredInstanceKeyPattern: affinity.preferredInstanceKeyPattern,
      createdAt: now,
    };
  }

  /**
   * Wake local workers and NOTIFY the cluster that new work landed. With a caller transaction the
   * announcement is deferred to commit, so a rolled-back insert never wakes anyone.
   */
  private announce(
    queue: string,
    patterns: Array<string | null>,
    tx: AddJobOptions<unknown>['tx'],
  ): void {
    const fire = (): void => {
      this.runtime.wakeup.signal(queue);
      // One NOTIFY per distinct affinity pattern: a listener filters on it, so collapsing them
      // would tell the wrong instances to wake.
      for (const pattern of new Set(patterns)) {
        this.runtime.background.run(() => this.notifier.notifyJobAdded(queue, pattern));
      }
    };
    if (tx?.onCommit) tx.onCommit(fire);
    else if (!tx) fire();
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
        `Job on queue '${queue}' sets 'preferredInstanceKeyPattern', but this process has no ` +
          `instance key. Pass \`instance: { instanceKey }\` to the PortQueue constructor to name it.`,
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
   * The idempotency lookup behind {@link addJob}. A one-off add checks the jobs table; a recurring
   * add checks the schedule table — a key is unique only within its own entity's table. Returns a
   * deduplicated result shaped for the matched entity, or null when the key is free in that table.
   */
  private async findIdempotencyDuplicate(
    queue: string,
    idempotencyKey: string,
    isRecurring: boolean,
    tx?: AddJobOptions<unknown>['tx'],
  ): Promise<AddJobResult | null> {
    const { driver } = this.runtime;
    if (isRecurring) {
      const schedule = await driver.findScheduleByIdempotencyKey({
        queueName: queue,
        idempotencyKey,
        ...(tx ? { tx } : {}),
      });
      if (!schedule) return null;
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
    if (!job) return null;
    return {
      jobId: job.id,
      queue,
      status: job.status,
      startAfter: new Date(job.startAfter),
      deduplicated: true,
      deduplicationReason: DeduplicationReason.IDEMPOTENCY,
    };
  }

  private async createSchedule<TData>(
    queue: string,
    opts: AddJobOptions<TData>,
  ): Promise<AddJobResult> {
    this.validateSchedule(queue, opts);
    const { registry, driver, clock, resolver, events } = this.runtime;
    await registry.ensure(queue);
    const queueOptions = registry.getOptions(queue);
    const affinity = this.resolveAffinity(queue, opts);
    const now = clock.now();
    const resolved = resolver.resolve({
      job: opts,
      ...(queueOptions.defaultJobOptions ? { queueDefaults: queueOptions.defaultJobOptions } : {}),
      ...(queueOptions.retention ? { queueRetention: queueOptions.retention } : {}),
      now,
    });
    const cron = opts.schedule?.cron != null ? normalizeCron(opts.schedule.cron) : null;
    const everySeconds =
      opts.schedule?.startEverySeconds != null
        ? wholeSeconds(opts.schedule.startEverySeconds, 'schedule.startEverySeconds')
        : null;
    // No pattern-based dedup: identical recurrences on a queue are allowed to coexist. When the
    // caller wants exactly one, they pass an idempotencyKey — that dedup ran in addJob() above, so
    // reaching here means the key was free (or absent) and we always insert a fresh schedule.
    const nextRunAt = this.computeNextRun(opts.schedule!, now);

    // Every option that shapes the *produced* jobs (beyond the columns below) rides along with the
    // schedule and is stamped onto each run — the schedule row itself is never expired/retained by
    // these; they govern the spawned jobs. `expireInSeconds` is stored as a duration and re-applied
    // relative to each run's fire time. See {@link ScheduledJobOptions}.
    const jobOptions: ScheduledJobOptions = {
      expireInSeconds:
        opts.expireInSeconds != null ? wholeSeconds(opts.expireInSeconds, 'expireInSeconds') : null,
      retryBackoff: resolved.retryBackoff,
      retryBackoffFactor: resolved.retryBackoffFactor,
      retryMaxDelaySeconds: resolved.retryMaxDelaySeconds,
      retryJitter: resolved.retryJitter,
      retentionMode: resolved.retentionMode,
      retentionTtlSeconds: resolved.retentionTtlSeconds,
      retentionStatuses: resolved.retentionStatuses,
      singletonKey: resolved.singletonKey,
      preferredInstanceKeyPattern: affinity.preferredInstanceKeyPattern,
    };

    const newSchedule: NewScheduleRow = {
      queueName: queue,
      cron: cron?.pattern ?? null,
      everySeconds,
      timezone: cron?.tz ?? null,
      data: opts.data,
      priority: resolved.priority,
      retryMaxAttempts: resolved.retryMaxAttempts,
      retryDelaySeconds: resolved.retryDelaySeconds,
      nextRunAt,
      enabled: true,
      startAt: null,
      endAt: null,
      idempotencyKey: resolved.idempotencyKey,
      jobOptions,
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

  /**
   * Reject any key the `schedule` group doesn't define. Without this an unknown key — a typo, or an
   * option that no longer exists like the old absolute-`Date` `startAfter` — is silently dropped and
   * the job runs immediately, which looks like the scheduler losing it. TypeScript already catches
   * this; the check is for JavaScript callers and hand-built payloads.
   */
  private rejectUnknownScheduleKeys(queue: string, schedule: ScheduleOptions): void {
    const allowed: ReadonlySet<string> = new Set<keyof ScheduleOptions>([
      'startAfterSeconds',
      'startEverySeconds',
      'cron',
    ]);
    const unknown = Object.keys(schedule).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      throw new InvalidOptionsError(
        `Unknown 'schedule' option${unknown.length > 1 ? 's' : ''} on queue '${queue}': ` +
          `${unknown.map((k) => `'${k}'`).join(', ')}. Valid keys are 'startAfterSeconds' (a ` +
          `one-off delay in seconds), 'startEverySeconds' (a recurring interval in seconds) and ` +
          `'cron'. Every duration is a whole number of seconds; there is no absolute-Date form.`,
        { queue },
      );
    }
  }

  private validateSchedule(queue: string, opts: AddJobOptions<unknown>): void {
    if (opts.schedule?.cron != null && opts.schedule?.startEverySeconds != null) {
      throw new InvalidOptionsError(
        `A recurring job on queue '${queue}' must set exactly one of 'schedule.cron' or 'schedule.startEverySeconds' — not both.`,
        { queue },
      );
    }
  }

  computeNextRun(schedule: ScheduleOptions, now: number): number {
    if (schedule.cron != null) {
      const { pattern, tz } = normalizeCron(schedule.cron);
      return new CronExpression(pattern, tz).next(now);
    }
    return now + wholeSecondsToMs(schedule.startEverySeconds!, 'schedule.startEverySeconds');
  }

  /**
   * A page of schedules — one queue's when `queue` is given, every queue's otherwise. Filtering and
   * paging both happen in the database; the count is a second query rather than a JOIN or a
   * whole-table read. **This is a read and behaves like one:** it does not ensure the queue row, so
   * listing the schedules of a name that was never used does not create it.
   */
  async getSchedules(query: GetSchedulesQuery = {}): Promise<Page<ScheduleInfo>> {
    const limit = Math.min(
      Math.max(Math.trunc(query.limit ?? DEFAULT_PAGE_LIMIT), 1),
      MAX_PAGE_LIMIT,
    );
    const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
    const filter = {
      ...(query.queue ? { queueName: query.queue } : {}),
      ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
    };
    const [rows, total] = await Promise.all([
      this.runtime.driver.listSchedules({ ...filter, limit, offset }),
      this.runtime.driver.countSchedules(filter),
    ]);
    return { items: rows.map((s) => toScheduleInfo(s)), total };
  }

  /** One schedule by id, or null when no schedule has that id. */
  async getSchedule(scheduleId: string): Promise<ScheduleInfo | null> {
    const row = await this.runtime.driver.getSchedule({ scheduleId });
    return row ? toScheduleInfo(row) : null;
  }
}

/** Map a schedule row to the public {@link ScheduleInfo}. */
function toScheduleInfo(s: {
  id: string;
  queueName: string;
  cron: string | null;
  everySeconds: number | null;
  timezone: string | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  enabled: boolean;
  idempotencyKey: string | null;
}): ScheduleInfo {
  return {
    scheduleId: s.id,
    queue: s.queueName,
    cron: s.cron,
    everySeconds: s.everySeconds,
    timezone: s.timezone,
    nextRunAt: s.nextRunAt != null ? new Date(s.nextRunAt) : null,
    lastRunAt: s.lastRunAt != null ? new Date(s.lastRunAt) : null,
    enabled: s.enabled,
    idempotencyKey: s.idempotencyKey,
  };
}

/** Normalize a {@link CronSpec} (string or `{ pattern, tz }`) to a pattern + IANA tz. */
function normalizeCron(cron: CronSpec): { pattern: string; tz: string } {
  if (typeof cron === 'string') return { pattern: cron, tz: 'UTC' };
  return { pattern: cron.pattern, tz: cron.tz ?? 'UTC' };
}
