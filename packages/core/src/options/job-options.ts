import type { RetentionOptions, RetryOptions } from './common';
import type { TransactionHandle } from '../tx/transaction-handle';

/**
 * Per-job producer options — highest precedence in the
 * client → queue → job merge. Never mixed with queue/worker options.
 *
 * Every duration here is **in seconds**.
 */
export interface JobOptions {
  priority?: number;
  /** How the job retries on failure ({@link RetryOptions}). Omit to run once. */
  retry?: RetryOptions;
  /** Expire the job if it hasn't started within this window, **in seconds**. */
  expireInSeconds?: number;
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
 * - **one-off** (default) — runs immediately, or after `startAfterSeconds`;
 * - **recurring interval** — `startEverySeconds` (seconds between runs);
 * - **recurring cron** — `cron` (a {@link CronSpec}).
 *
 * `startAfterSeconds` is mutually exclusive with the recurring modes. Every value here is **in
 * seconds** — there is deliberately no absolute-`Date` variant of any of them, so there is exactly
 * one way to express a delay. For a known wall-clock instant, subtract: `(at - Date.now()) / 1000`.
 */
export interface ScheduleOptions {
  /** Delay a one-off job by this many **seconds** from now. */
  startAfterSeconds?: number;
  /** Recurring: **seconds** between runs, e.g. `30`. */
  startEverySeconds?: number;
  /** Recurring: a cron expression, optionally with a timezone. */
  cron?: CronSpec;
}

/**
 * The full add-a-job options. `data` is a named key, never positional.
 *
 * Timing lives under the `schedule` group ({@link ScheduleOptions}) — a one-off delay
 * (`startAfterSeconds`), a fixed interval (`startEverySeconds`), or a `cron`
 * expression. Omit `schedule` to run immediately. Every duration is **in seconds**.
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
   * expression (source string, matched unanchored — e.g. `'ram-8gb'`, or `'ram-8gb.*cpu-4cor'` to
   * require both tags). Requires an `instanceKey` on the PortQueue.
   * A pattern spans many instances by design — prefer it to pinning one server. If no live
   * instance matches, the job waits until one does. Omit to run on any instance.
   */
  preferredInstanceKeyPattern?: string;
};
