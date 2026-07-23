import type { JobStatus } from './job-state.enum.js';
import { BackoffStrategy, DeduplicationReason, RetentionMode } from '../options/enums.js';
import type { JobMetadata } from '../options/common.js';

/**
 * The normalized in-memory shape of a `job` row. Drivers own the
 * mapping between engine storage (timestamps, JSON, enums) and this record; core only
 * ever sees this shape. All keys camelCase; timestamps are epoch ms or null.
 */
export interface JobRecord {
  id: string;
  queueName: string;
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
  /** The auto-detected identity of the process currently holding the lock (stall attribution). */
  lockedByInstanceId: string | null;
  /** The instance key this job prefers to run on (affinity), or null for any instance. */
  preferredInstanceKey: string | null;
  /** A regex (source string) matching the instance keys this job prefers to run on. */
  preferredInstanceKeyPattern: string | null;
  /** The instance key to fall back to if no preferred instance is alive. */
  fallbackInstanceKey: string | null;
  /** A regex (source string) matching the fallback instance keys, used when preferred is dead. */
  fallbackInstanceKeyPattern: string | null;
  /** The instance key that actually claimed/processed this job (set at claim time). */
  processedOnInstanceKey: string | null;
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

/** The row to insert — a fully resolved job with defaults applied. */
export interface NewJobRecord {
  id?: string;
  queueName: string;
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
  preferredInstanceKey: string | null;
  preferredInstanceKeyPattern: string | null;
  fallbackInstanceKey: string | null;
  fallbackInstanceKeyPattern: string | null;
  createdAt: number;
}

/** The result of an insert. */
export interface InsertedJobRow {
  id: string;
  status: JobStatus;
  startAfter: number;
  workflowId: string | null;
  /** True if an idempotency/singleton match returned the existing job instead of inserting. */
  deduplicated: boolean;
  deduplicationReason?: DeduplicationReason;
}

export interface QueueRow {
  name: string;
  processingPaused: boolean;
  acceptingPaused: boolean;
  createdAt: number;
  updatedAt: number;
}

/** The normalized in-memory shape of an `instance` row. */
export interface InstanceRow {
  instanceKey: string;
  processingPaused: boolean;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
}

export interface ScheduleRow {
  id: string;
  queueName: string;
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
  /** Optional dedup token. When set, only one job/schedule with this key exists per queue. */
  idempotencyKey: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A new schedule to insert. */
export interface NewScheduleRow {
  id?: string;
  queueName: string;
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
  /** Optional dedup token. When set, only one job/schedule with this key exists per queue. */
  idempotencyKey: string | null;
}

export interface ThroughputPoint {
  bucketStart: number;
  completed: number;
  failed: number;
}
