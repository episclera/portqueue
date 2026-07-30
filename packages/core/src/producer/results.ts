import type { JobStatus } from '../jobs/job-state.enum';
import type { DeduplicationReason } from '../options/enums';
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

/** Query for paged instance reads. Same `limit`/`offset` window as {@link GetJobsQuery}. */
export type GetInstancesQuery = PageQuery;

/** Query for paged queue reads. Same `limit`/`offset` window as {@link GetJobsQuery}. */
export type GetQueuesQuery = PageQuery;
