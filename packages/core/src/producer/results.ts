import type { JobStatus } from '../jobs/job-state.enum';
import type { DeduplicationReason } from '../options/enums';

export type { Page } from '../options/common';

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
  /** Job counts by status attributed to this instance (by `processedOnInstanceKey`). */
  counts: Record<JobStatus, number>;
}

/** Aggregated stats for a queue or the whole client. */
export interface QueueStats {
  queue?: string;
  counts: Record<JobStatus, number>;
}

/** Query for paged job reads. */
export interface GetJobsQuery {
  queue?: string;
  statuses?: JobStatus[];
  scheduleId?: string;
  limit?: number;
  cursor?: string;
  /** Row offset for numbered pagination. Takes precedence over `cursor` when both are given. */
  offset?: number;
  order?: 'asc' | 'desc';
}
