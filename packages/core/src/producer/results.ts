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
   * instead of creating a new one. Idempotency matches span both the job and schedule tables.
   */
  deduplicated: boolean;
  deduplicationReason?: DeduplicationReason;
  /** When a one-off job becomes due. */
  startAfter?: Date;
  /** Present only for a workflow queue: the run id minted for this job. */
  workflowId?: string;
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
  workflowId?: string | null;
  workflowStepKey?: string | null;
  /** True when ACTIVE and past its lock deadline (derived). */
  stalled: boolean;
}

/** A whole workflow run: its steps as an ordered list of snapshots. */
export interface WorkflowSnapshot {
  workflowId: string;
  queue: string;
  steps: JobSnapshot[];
}

/** Info about a recurring schedule. */
export interface ScheduleInfo {
  scheduleId: string;
  cron?: string | null;
  every?: number | null;
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
  /** Jobs completed per minute over the recent window. */
  throughputPerMinute: number;
  /** Failed / (completed + failed) over the recent window. */
  failureRate: number;
}

/** Query for paged job reads. */
export interface GetJobsQuery {
  queue?: string;
  statuses?: JobStatus[];
  scheduleId?: string;
  workflowId?: string;
  limit?: number;
  cursor?: string;
  order?: 'asc' | 'desc';
}
