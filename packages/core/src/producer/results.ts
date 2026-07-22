import type { JobStatus } from '../jobs/job-state.enum.js';
import type { DeduplicationReason } from '../options/enums.js';
import type { JobMetadata } from '../options/common.js';

export type { Page } from '../options/common.js';

/**
 * The structured result of producing a job (build_plan/05.3). One shape for both the
 * one-off and recurring modes; fields are populated per mode. Never a bare id.
 */
export interface AddJobResult {
  /** The inserted job id (one-off add; absent when only a schedule was created). */
  jobId?: string;
  /** The schedule correlation id (present when `schedule` was passed or a produced job). */
  scheduleId?: string;
  /** When the first/next scheduled run materializes. */
  nextRunAt?: Date | null;
  queue: string;
  /** The created job's status (one-off). */
  status?: JobStatus;
  /** True if an idempotency/singleton guard matched an existing job. */
  deduplicated: boolean;
  deduplicationReason?: DeduplicationReason;
  /** When a one-off job becomes due. */
  startAfter?: Date;
  /** Present only for a workflow queue: the run id minted for this job. */
  workflowId?: string;
}

/** A read-side snapshot of a job (build_plan/05.2). */
export interface JobSnapshot<TData = unknown> {
  id: string;
  queue: string;
  status: JobStatus;
  data: TData;
  returnValue?: unknown;
  metadata: JobMetadata;
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
  runOnInstanceId?: string | null;
  runOnInstanceType?: string | null;
  failureMessage?: string | null;
  idempotencyKey?: string | null;
  scheduleId?: string | null;
  workflowId?: string | null;
  workflowStepKey?: string | null;
  /** True when ACTIVE and past its lock deadline (derived, build_plan/06.1). */
  stalled: boolean;
}

/** A whole workflow run: its steps as an ordered list of snapshots (build_plan/05.3). */
export interface WorkflowSnapshot {
  workflowId: string;
  queue: string;
  steps: JobSnapshot[];
}

/** Info about a recurring schedule (build_plan/05.3). */
export interface ScheduleInfo {
  scheduleId: string;
  cron?: string | null;
  every?: number | null;
  timezone?: string | null;
  nextRunAt?: Date | null;
  lastRunAt?: Date | null;
  enabled: boolean;
}

/** Queue overview info (build_plan/05.2). */
export interface QueueInfo {
  name: string;
  processingPaused: boolean;
  acceptingPaused: boolean;
  counts: Record<JobStatus, number>;
}

/** Aggregated stats for a queue or the whole client (build_plan/05.2). */
export interface QueueStats {
  queue?: string;
  counts: Record<JobStatus, number>;
  /** Jobs completed per minute over the recent window. */
  throughputPerMinute: number;
  /** Failed / (completed + failed) over the recent window. */
  failureRate: number;
}

/** Query for paged job reads (build_plan/05.2). */
export interface GetJobsQuery {
  queue?: string;
  statuses?: JobStatus[];
  scheduleId?: string;
  workflowId?: string;
  limit?: number;
  cursor?: string;
  order?: 'asc' | 'desc';
}
