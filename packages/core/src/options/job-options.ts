import type { Duration } from '../util/duration';
import type { RetentionOptions, RetryOptions } from './common';
import type { TransactionHandle } from '../tx/transaction-handle';

/**
 * Per-job producer options — highest precedence in the
 * client → queue → job merge. Never mixed with queue/worker options.
 */
export interface JobOptions {
  priority?: number;
  /** How the job retries on failure ({@link RetryOptions}). Omit to run once. */
  retry?: RetryOptions;
  /** Expire the job if it hasn't started within this window. */
  expireIn?: Duration;
  retention?: RetentionOptions;
  idempotencyKey?: string;
  singletonKey?: string;
  /** Transactional enqueue: your own transaction wrapped by an adapter. */
  tx?: TransactionHandle;
}

/**
 * A cron schedule: a 5- or 6-field expression string evaluated in UTC,
 * or an object pairing the expression with an IANA timezone.
 */
export type CronSpec = string | { pattern: string; tz?: string };

/**
 * When a job runs. Exactly one timing mode may be set:
 * - **one-off** (default) — runs immediately, or at `startAfter` if given;
 * - **recurring interval** — `startEvery` (a `Duration` between runs);
 * - **recurring cron** — `cron` (a {@link CronSpec}).
 *
 * `startAfter` is mutually exclusive with the recurring modes.
 */
export interface ScheduleOptions {
  /** Delay a one-off job — run not before this time. A `Date`, or a `Duration` from now. */
  startAfter?: Date | Duration;
  /** Recurring: a fixed interval between runs, e.g. `'30s'`. */
  startEvery?: Duration;
  /** Recurring: a cron expression, optionally with a timezone. */
  cron?: CronSpec;
}

/**
 * The full add-a-job options. `data` is a named key, never positional.
 *
 * Timing lives under the `schedule` group ({@link ScheduleOptions}) — a one-off delay
 * (`startAfter`), a fixed interval (`startEvery`), or a `cron` expression. Omit `schedule`
 * to run immediately.
 *
 * Identical recurrences may coexist; pass an `idempotencyKey` to guarantee a single one. Dedup is
 * queue-scoped and per-entity, first-writer-wins: a one-off add dedups against the jobs table, a
 * recurring add against the schedule table (the two never dedup against each other).
 */
export type AddJobOptions<TData> = JobOptions & {
  data: TData;
  /** When the job runs: a one-off delay, a fixed interval, or a cron expression. */
  schedule?: ScheduleOptions;
  /**
   * Multi-instance affinity: run this job only on instances whose key matches this regular
   * expression (source string, e.g. `'ram-(4|8)gb'`). Requires an `instanceKey` on the PortQueue.
   * A pattern spans many instances by design — prefer it to pinning one server. If no live
   * instance matches, the job waits until one does. Omit to run on any instance.
   */
  preferredInstanceKeyPattern?: string;
};
