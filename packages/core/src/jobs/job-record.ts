import type { JobStatus } from './job-state.enum.js';
import { BackoffStrategy, InstanceType, RetentionMode } from '../options/enums.js';
import type { JobMetadata } from '../options/common.js';

/**
 * The normalized in-memory shape of a `job` row (build_plan/04.2). Drivers own the
 * mapping between engine storage (timestamps, JSON, enums) and this record; core only
 * ever sees this shape. All keys camelCase; timestamps are epoch ms or null.
 */
export interface JobRecord {
  id: string;
  queueId: string;
  status: JobStatus;
  priority: number;
  data: unknown;
  returnValue: unknown;
  metadata: JobMetadata;
  createdAt: number;
  updatedAt: number;
  startAfter: number;
  expireAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  failedAt: number | null;
  retriedAt: number | null;
  stalledAt: number | null;
  cancelledAt: number | null;
  expiredAt: number | null;
  lockedUntil: number | null;
  lockedByInstanceId: string | null;
  runOnInstanceId: string | null;
  runOnInstanceType: InstanceType | null;
  retryAttempt: number;
  retryMaxAttempts: number;
  retryDelayMs: number;
  retryBackoff: BackoffStrategy;
  retryBackoffFactor: number | null;
  retryMaxDelayMs: number | null;
  retryJitter: boolean;
  failureMessage: string | null;
  retentionMode: RetentionMode;
  retentionTtlMs: number | null;
  idempotencyKey: string | null;
  scheduleId: string | null;
  singletonKey: string | null;
  workflowId: string | null;
  workflowStepKey: string | null;
}

/** The row to insert — a fully resolved job with defaults applied (build_plan/02.5). */
export interface NewJobRecord {
  id?: string;
  queueId: string;
  status: JobStatus;
  priority: number;
  data: unknown;
  metadata: JobMetadata;
  startAfter: number;
  expireAt: number | null;
  retryAttempt: number;
  retryMaxAttempts: number;
  retryDelayMs: number;
  retryBackoff: BackoffStrategy;
  retryBackoffFactor: number | null;
  retryMaxDelayMs: number | null;
  retryJitter: boolean;
  retentionMode: RetentionMode;
  retentionTtlMs: number | null;
  idempotencyKey: string | null;
  scheduleId: string | null;
  singletonKey: string | null;
  workflowId: string | null;
  workflowStepKey: string | null;
  runOnInstanceId: string | null;
  runOnInstanceType: InstanceType | null;
  createdAt: number;
}

/** The result of an insert (build_plan/03.2). */
export interface InsertedJobRow {
  id: string;
  status: JobStatus;
  startAfter: number;
  workflowId: string | null;
  /** True if a unique constraint matched and the existing row is returned instead. */
  deduplicated: boolean;
  deduplicationReason?: 'IDEMPOTENCY' | 'SINGLETON';
}

export interface QueueRow {
  id: string;
  name: string;
  processingPaused: boolean;
  acceptingPaused: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleRow {
  id: string;
  key: string;
  queueId: string;
  cron: string | null;
  everyMs: number | null;
  timezone: string | null;
  data: unknown;
  priority: number | null;
  retryMaxAttempts: number | null;
  retryDelayMs: number | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  enabled: boolean;
  startAt: number | null;
  endAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** A new schedule to upsert. */
export interface NewScheduleRow {
  id?: string;
  key: string;
  queueId: string;
  cron: string | null;
  everyMs: number | null;
  timezone: string | null;
  data: unknown;
  priority: number | null;
  retryMaxAttempts: number | null;
  retryDelayMs: number | null;
  nextRunAt: number | null;
  enabled: boolean;
  startAt: number | null;
  endAt: number | null;
}

export interface ThroughputPoint {
  bucketStart: number;
  completed: number;
  failed: number;
}
