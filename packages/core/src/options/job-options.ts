import type { Duration } from '../util/duration.js';
import type { BackoffOptions, JobMetadata, RetentionOptions } from './common.js';
import type { TransactionHandle } from '../tx/transaction-handle.js';

/**
 * Per-job producer options — highest precedence in the
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
 * A cron schedule: a 5- or 6-field expression string evaluated in UTC,
 * or an object pairing the expression with an IANA timezone.
 */
export type CronSpec = string | { pattern: string; tz?: string };

/**
 * The full add-a-job options. `data` is a named key, never positional.
 *
 * Timing is one of three mutually-exclusive modes:
 * - **one-off** (default) — runs immediately, or at `startAfter` if given;
 * - **recurring interval** — `startEvery` (a `Duration` between runs);
 * - **recurring cron** — `cron` (a {@link CronSpec}).
 *
 * A recurring add creates/updates a schedule keyed by its own pattern: re-adding the same
 * `startEvery`/`cron` on a queue updates that schedule; a different pattern makes a new one.
 */
export type AddJobOptions<TData, TInstanceKey extends string = string> = JobOptions & {
  data: TData;
  /** Recurring: a fixed interval between runs, e.g. `'30s'`. */
  startEvery?: Duration;
  /** Recurring: a cron expression, optionally with a timezone. */
  cron?: CronSpec;
  /** For a workflow queue: begin at a non-entry step (rare; defaults to the entry step). */
  startStep?: string;
  /**
   * Multi-instance affinity: prefer to run this job on the instance with this exact key.
   * Requires `instanceKey` on the PortQueue. Mutually exclusive with `preferredInstanceKeyPattern`.
   */
  preferredInstanceKey?: TInstanceKey;
  /**
   * Multi-instance affinity: prefer to run this job on any live instance whose key matches
   * this regular expression (source string, e.g. `'^worker-eu-'`). Requires `instanceKey`.
   * Mutually exclusive with `preferredInstanceKey`.
   */
  preferredInstanceKeyPattern?: string;
  /**
   * If no preferred instance is alive, fall back to the instance with this exact key.
   * Requires `instanceKey`. Mutually exclusive with `fallbackInstanceKeyPattern`.
   */
  fallbackInstanceKey?: TInstanceKey;
  /**
   * If no preferred instance is alive, fall back to any live instance whose key matches this
   * regular expression (source string). Requires `instanceKey`. Mutually exclusive with
   * `fallbackInstanceKey`.
   */
  fallbackInstanceKeyPattern?: string;
};
