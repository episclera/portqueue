import type { Duration } from '../util/duration.js';
import type { BackoffOptions, JobMetadata, RetentionOptions } from './common.js';
import type { TransactionHandle } from '../tx/transaction-handle.js';

/**
 * Per-job producer options (build_plan/05.6) — highest precedence in the
 * client → queue → job merge. Never mixed with queue/worker options.
 */
export interface JobOptions {
  priority?: number;
  /** `delay` and `startAfter` both mean "not before"; pass at most one. */
  delay?: Duration;
  startAfter?: Date | Duration;
  retryMaxAttempts?: number;
  retryDelay?: Duration;
  retryBackoff?: BackoffOptions;
  /** Expire the job if it hasn't started within this window. */
  expireIn?: Duration;
  retention?: RetentionOptions;
  idempotencyKey?: string;
  singletonKey?: string;
  metadata?: JobMetadata;
  /** Transactional enqueue: your own transaction wrapped by an adapter. */
  tx?: TransactionHandle;
}

/** A recurring schedule specification (build_plan/05.3). */
export interface ScheduleSpec {
  /** Stable id; re-adding with the same (queue, key) updates the schedule. */
  key: string;
  /** Exactly one of `cron` or `every`. */
  cron?: string;
  every?: Duration;
  /** IANA timezone for cron evaluation (default UTC). */
  timezone?: string;
  startAt?: Date;
  endAt?: Date;
}

/**
 * The full add-a-job options (build_plan/05.3). `data` is a named key, never positional.
 * Passing `schedule` turns this into a recurring producer instead of a one-off insert.
 */
export type AddJobOptions<TData> = JobOptions & {
  data: TData;
  /** Present → create/update a recurring schedule using `data` + options as the template. */
  schedule?: ScheduleSpec;
  /** For a workflow queue: begin at a non-entry step (rare; defaults to the entry step). */
  startStep?: string;
};
