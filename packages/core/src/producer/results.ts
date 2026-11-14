import type { JobStatus } from '../jobs/job-state.enum';
import type { BatchItemOutcome, DeduplicationReason } from '../options/enums';
import type { PageQuery } from '../options/common';

export type { Page, PageQuery } from '../options/common';

/**
 * The structured result of producing a job. One shape for both the
 * one-off and recurring modes; fields are populated per mode. Never a bare id.
 */
export interface AddJobResult {
  /** The inserted job id (one-off add; absent when only a schedule was created). */
  jobId?: string;
  /** The schedule correlation id (present when a schedule was created or matched by dedup). */
  scheduleId?: string;
  /** When the first/next scheduled run materializes. */
  nextRunAt?: Date | null;
  queue: string;
  /** The created job's status (one-off). */
  status?: JobStatus;
  /**
   * True if an idempotency/singleton guard matched an existing job or schedule and returned it
   * instead of creating a new one. An idempotency match is per-entity: a one-off add matches an
   * existing job, a recurring add matches an existing schedule.
   */
  deduplicated: boolean;
  deduplicationReason?: DeduplicationReason;
  /** When a one-off job becomes due. */
  startAfter?: Date;
}

/**
 * One item of a plural method's result. A batch returns one of these **per id or name it was
 * given, in the order given**, so a caller can line the result up with its input.
 */
export interface BatchItemResult {
  outcome: BatchItemOutcome;
}

/** One job's outcome in `cancelJobs`. */
export interface JobBatchItem extends BatchItemResult {
  jobId: string;
  /** The queue the row is on — present whenever the id named a row. */
  queue?: string;
}

/** One job's outcome in `retryJobs`; an `APPLIED` item also carries what `retryJob` reports. */
export interface RetriedJobItem extends JobBatchItem {
  /** The re-armed job's status (`APPLIED` only). */
  status?: JobStatus;
  /** When the re-armed job becomes due (`APPLIED` only). */
  startAfter?: Date;
}

/** One schedule's outcome in `removeSchedules`. */
export interface ScheduleBatchItem extends BatchItemResult {
  scheduleId: string;
  /** The queue the schedule produced onto (`APPLIED` only). */
  queue?: string;
}

/** One queue's outcome in `pauseQueues` / `resumeQueues`. */
export interface QueueBatchItem extends BatchItemResult {
  queue: string;
}

/** One instance's outcome in `pauseInstances` / `resumeInstances` / `removeInstances`. */
export interface InstanceBatchItem extends BatchItemResult {
  instanceKey: string;
}

/** A read-side snapshot of a job. */
export interface JobSnapshot<TData = unknown> {
  id: string;
  queue: string;
  status: JobStatus;
  data: TData;
  returnValue?: unknown;
  priority: number;
  retryAttempt: number;
  retryMaxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  startAfter: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  failedAt?: Date | null;
  cancelledAt?: Date | null;
  expiredAt?: Date | null;
  retriedAt?: Date | null;
  stalledAt?: Date | null;
  lockedUntil?: Date | null;
  preferredInstanceKeyPattern?: string | null;
  processedOnInstanceKey?: string | null;
  failureMessage?: string | null;
  idempotencyKey?: string | null;
  scheduleId?: string | null;
  /** True when ACTIVE and past its lock deadline (derived). */
  stalled: boolean;
}

/** Info about a recurring schedule. */
export interface ScheduleInfo {
  scheduleId: string;
  /** The queue this schedule produces onto. */
  queue: string;
  cron?: string | null;
  /** For an interval schedule: the seconds between runs. */
  everySeconds?: number | null;
  timezone?: string | null;
  nextRunAt?: Date | null;
  lastRunAt?: Date | null;
  enabled: boolean;
  /** The dedup token this schedule was created with, if any. */
  idempotencyKey?: string | null;
}

/** Queue overview info. */
export interface QueueInfo {
  name: string;
  processingPaused: boolean;
  acceptingPaused: boolean;
  counts: Record<JobStatus, number>;
  /** True when this queue is declared (in use) in the process that produced this info. */
  inUse: boolean;
}

/** Instance overview info for the dashboard/CLI. */
export interface InstanceInfo {
  instanceKey: string;
  processingPaused: boolean;
  /** True when the instance's last heartbeat is within the liveness window. */
  alive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
  /**
   * The health of the **Node process** behind this instance, at its last heartbeat, both 0-100:
   * `cpuPercent` over the cores available to it, `memoryPercent` over V8's heap limit. Neither is a
   * machine-wide figure. Null until its first beat.
   */
  cpuPercent: number | null;
  memoryPercent: number | null;
  /** Job counts by status attributed to this instance (by `processedOnInstanceKey`). */
  counts: Record<JobStatus, number>;
}

/** Aggregated stats for a queue or the whole client. */
export interface QueueStats {
  queue?: string;
  counts: Record<JobStatus, number>;
}

/**
 * Query for paged job reads. Paging is `limit`/`offset` and nothing else — there is no cursor and
 * no sort direction, because jobs always come back newest-first and one paging mechanism is enough
 * (see the one-option-per-thing invariant in CLAUDE.md).
 */
export interface GetJobsQuery extends PageQuery {
  queue?: string;
  statuses?: JobStatus[];
  scheduleId?: string;
}

/** Query for a paged schedule read. Same `limit`/`offset` window as {@link GetJobsQuery}. */
export interface GetSchedulesQuery extends PageQuery {
  /** Narrow to one queue's schedules; omit for every queue's. */
  queue?: string;
  /** `true` → only armed schedules, `false` → only disarmed ones, absent → both. */
  enabled?: boolean;
}

/**
 * Query for paged instance reads. Same `limit`/`offset` window as {@link GetJobsQuery}, plus the
 * narrowings the driver applies **in SQL** — so finding the paused or stale instances never means
 * paging the whole table and filtering in the process.
 */
export interface GetInstancesQuery extends PageQuery {
  /** Case-insensitive substring of the instance key. */
  search?: string;
  /** `true` → only paused instances, `false` → only running ones, absent → both. */
  processingPaused?: boolean;
  /**
   * `true` → only instances inside the liveness window, `false` → only stale ones, absent → both.
   * The window is the same {@link InstanceInfo.alive} reports, derived from the heartbeat interval.
   */
  alive?: boolean;
}

/**
 * Query for paged queue reads. Same `limit`/`offset` window as {@link GetJobsQuery}, plus the two
 * narrowings the driver applies in SQL. They are on the public query rather than dashboard-only
 * because the alternative for a developer looking for paused queues was to page the whole table and
 * filter in process — exactly what the filter-in-the-database invariant exists to prevent.
 */
export interface GetQueuesQuery extends PageQuery {
  /** Case-insensitive substring of the queue name. */
  search?: string;
  /** `true` → only paused queues, `false` → only running ones, absent → both. */
  processingPaused?: boolean;
}
