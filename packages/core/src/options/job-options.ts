import type { Duration } from '../util/duration';
import type { BackoffOptions, JobMetadata, RetentionOptions } from './common';
import type { TransactionHandle } from '../tx/transaction-handle';

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
 * Identical recurrences may coexist; pass an `idempotencyKey` to guarantee a single one (it dedups
 * across both the job and schedule tables, queue-scoped, first-writer-wins).
 */
export type AddJobOptions<TData> = JobOptions & {
  data: TData;
  /** Recurring: a fixed interval between runs, e.g. `'30s'`. */
  startEvery?: Duration;
  /** Recurring: a cron expression, optionally with a timezone. */
  cron?: CronSpec;
  /** For a workflow queue: begin at a non-entry step (rare; defaults to the entry step). */
  startStep?: string;
  /**
   * Multi-instance affinity: run this job only on instances whose key matches this regular
   * expression (source string, e.g. `'ram-(4|8)gb'`). Requires an `instanceKey` on the PortQueue.
   * A pattern spans many instances by design — prefer it to pinning one server. If no live
   * instance matches, the job waits until one does. Omit to run on any instance.
   */
  preferredInstanceKeyPattern?: string;
};
