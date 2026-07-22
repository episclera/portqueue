import type { Duration } from '../util/duration.js';
import type { BackoffOptions, JobMetadata, RetentionOptions } from './common.js';
import type { TransactionHandle } from '../tx/transaction-handle.js';

/**
 * Per-job producer options (build_plan/05.6) — highest precedence in the
 * client → queue → job merge. Never mixed with queue/worker options.
 */
export interface JobOptions {
  priority?: number;
  /** Delay a one-off job — run not before this time. A `Date`, or a `Duration` from now. */
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

/**
 * A cron schedule (build_plan/05.3): a 5- or 6-field expression string evaluated in UTC,
 * or an object pairing the expression with an IANA timezone.
 */
export type CronSpec = string | { pattern: string; tz?: string };

/**
 * The full add-a-job options (build_plan/05.3). `data` is a named key, never positional.
 *
 * Timing is one of three mutually-exclusive modes:
 * - **one-off** (default) — runs immediately, or at `startAfter` if given;
 * - **recurring interval** — `startEvery` (a `Duration` between runs);
 * - **recurring cron** — `cron` (a {@link CronSpec}).
 *
 * A recurring add creates/updates a schedule keyed by its own pattern: re-adding the same
 * `startEvery`/`cron` on a queue updates that schedule; a different pattern makes a new one.
 */
export type AddJobOptions<TData> = JobOptions & {
  data: TData;
  /** Recurring: a fixed interval between runs, e.g. `'30s'`. */
  startEvery?: Duration;
  /** Recurring: a cron expression, optionally with a timezone. */
  cron?: CronSpec;
  /** For a workflow queue: begin at a non-entry step (rare; defaults to the entry step). */
  startStep?: string;
};
