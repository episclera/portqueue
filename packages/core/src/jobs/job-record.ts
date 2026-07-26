import type { JobStatus } from './job-state.enum';
import { BackoffStrategy, DeduplicationReason, RetentionMode } from '../options/enums';

/**
 * The normalized in-memory shape of a `job` row. Drivers own the
 * mapping between engine storage (timestamps, JSON, enums) and this record; core only
 * ever sees this shape. All keys camelCase; timestamps are epoch ms or null, and every
 * configured duration is seconds.
 */
export interface JobRecord {
  id: string;
  queueName: string;
  status: JobStatus;
  priority: number;
  data: unknown;
  returnValue: unknown;
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
  /** A regex (source string) matching the instance keys this job may run on, or null for any. */
  preferredInstanceKeyPattern: string | null;
  /** The instance key that actually claimed/processed this job, or null when the process is unnamed. */
  processedOnInstanceKey: string | null;
  retryAttempt: number;
  retryMaxAttempts: number;
  retryDelaySeconds: number;
  retryBackoff: BackoffStrategy;
  retryBackoffFactor: number | null;
  retryMaxDelaySeconds: number | null;
  retryJitter: boolean;
  failureMessage: string | null;
  retentionMode: RetentionMode;
  retentionTtlSeconds: number | null;
  idempotencyKey: string | null;
  scheduleId: string | null;
  singletonKey: string | null;
}

/** The row to insert — a fully resolved job with defaults applied. */
export interface NewJobRecord {
  id?: string;
  queueName: string;
  status: JobStatus;
  priority: number;
  data: unknown;
  startAfter: number;
  expireAt: number | null;
  retryAttempt: number;
  retryMaxAttempts: number;
  retryDelaySeconds: number;
  retryBackoff: BackoffStrategy;
  retryBackoffFactor: number | null;
  retryMaxDelaySeconds: number | null;
  retryJitter: boolean;
  retentionMode: RetentionMode;
  retentionTtlSeconds: number | null;
  idempotencyKey: string | null;
  scheduleId: string | null;
  singletonKey: string | null;
  preferredInstanceKeyPattern: string | null;
  createdAt: number;
}

/** The result of an insert. */
export interface InsertedJobRow {
  id: string;
  status: JobStatus;
  startAfter: number;
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
  everySeconds: number | null;
  timezone: string | null;
  data: unknown;
  priority: number | null;
  retryMaxAttempts: number | null;
  retryDelaySeconds: number | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  enabled: boolean;
  startAt: number | null;
  endAt: number | null;
  /** Optional dedup token. When set, only one job/schedule with this key exists per queue. */
  idempotencyKey: string | null;
  /** The resolved per-run job template stamped onto every job this schedule spawns. */
  jobOptions: ScheduledJobOptions | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * The per-run job template a recurring schedule carries — every option passed to the recurring
 * `addJob` that shapes the *spawned jobs* (not the schedule itself), beyond the fields the schedule
 * already stores as columns (`priority`, `retryMaxAttempts`, `retryDelaySeconds`). `expireInSeconds` is a
 * duration re-applied relative to each run's fire time. Persisted as one JSON column so new options
 * don't need a schema change.
 */
export interface ScheduledJobOptions {
  expireInSeconds: number | null;
  retryBackoff: BackoffStrategy;
  retryBackoffFactor: number | null;
  retryMaxDelaySeconds: number | null;
  retryJitter: boolean;
  retentionMode: RetentionMode;
  retentionTtlSeconds: number | null;
  singletonKey: string | null;
  preferredInstanceKeyPattern: string | null;
}

/** A new schedule to insert. */
export interface NewScheduleRow {
  id?: string;
  queueName: string;
  cron: string | null;
  everySeconds: number | null;
  timezone: string | null;
  data: unknown;
  priority: number | null;
  retryMaxAttempts: number | null;
  retryDelaySeconds: number | null;
  nextRunAt: number | null;
  enabled: boolean;
  startAt: number | null;
  endAt: number | null;
  /** Optional dedup token. When set, only one job/schedule with this key exists per queue. */
  idempotencyKey: string | null;
  /** The resolved per-run job template stamped onto every job this schedule spawns. */
  jobOptions: ScheduledJobOptions | null;
}
