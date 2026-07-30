import { BackoffStrategy } from './enums';
import type { JobStatus } from '../jobs/job-state.enum';

/** Exponential/fixed backoff configuration. */
export interface BackoffOptions {
  strategy: BackoffStrategy;
  /** Growth factor for EXPONENTIAL (default 2); ignored for FIXED. */
  factor?: number;
  /** Cap on the computed delay, in **whole seconds**. */
  maxDelaySeconds?: number;
  /** Apply jitter to spread retries across instances. */
  jitter?: boolean;
}

/** How a job retries after a failed attempt. Omit to run once with no retry. */
export interface RetryOptions {
  /** Max attempts including the first (default 1 — no retry). */
  maxAttempts?: number;
  /** Delay before a retry, in **whole seconds**. */
  delaySeconds?: number;
  /** Exponential/fixed backoff applied to `delaySeconds`. */
  backoff?: BackoffOptions;
}

/**
 * Deletes a finished job once its TTL has elapsed. There is no second policy and no mode to pick:
 * set `retention` and the job is deleted `ttlSeconds` after it finished, omit it and the row is kept
 * forever.
 */
export interface RetentionOptions {
  /** How long after finishing before the job is deleted, in **whole seconds**. */
  ttlSeconds: number;
  /** Which finished statuses the policy applies to (default: every finished status). */
  statuses?: JobStatus[];
}

/**
 * Everything that tunes a worker's throughput, grouped in one place: how many jobs run and are
 * claimed at once, how often it polls, the lock window, and the rate cap. Omit the whole group to
 * run with sensible defaults (unbounded rate, concurrency 1).
 *
 * Whether a worker pauses under system pressure is **not** set here — it follows from
 * `systemLimiter` on the PortQueue: define one and every worker respects it, omit it and none do.
 *
 * Every duration here is **in seconds**. `rateDurationSeconds` is stored with the job and must be a
 * whole number; the poll and lock cadences never leave the process, so they may be fractional.
 */
export interface LimiterOptions {
  /** Max handlers running concurrently in this worker (default 1). */
  concurrency?: number;
  /**
   * Worker-local (exact, in-process) token-bucket rate cap: at most `rateMax` jobs started per
   * `rateDurationSeconds` window. Both are required together to enable rate limiting.
   */
  rateMax?: number;
  /** The window for `rateMax`, in **whole seconds** — e.g. `60` for "per minute". */
  rateDurationSeconds?: number;
  /** Max jobs claimed per fetch (defaults to `concurrency`). */
  batchSize?: number;
  /** Poll cadence when LISTEN/NOTIFY is unavailable, **in seconds** (default 5). */
  pollIntervalSeconds?: number;
  /** Visibility timeout / heartbeat window for a claimed job, **in seconds** (default 30). */
  lockDurationSeconds?: number;
}

/**
 * Thresholds on **this process's** health that pause job claiming while they are breached.
 *
 * CPU and memory are read for the Node process, not the host: CPU time this process burned
 * (`process.cpuUsage()`) over the core-time available to it, and heap used over the heap limit V8
 * would kill it at (`v8.getHeapStatistics()`). Both are 0-100. Host-wide readings were tried and
 * are the wrong signal — Linux and macOS both count allocated-but-idle memory as used, so
 * `os.freemem()` reports 90%+ on a machine doing nothing and a memory threshold never clears; and a
 * process in a container has its own limits well under the host's, so the host number is not the
 * ceiling it dies at.
 *
 * Passing this object is what turns system backpressure on: every worker on the client then stops
 * claiming while any threshold is over, and resumes once every watched metric is back at or under
 * its limit. Omit it (the default) and nothing throttles — the metrics are still sampled and still
 * recorded against the instance row, they simply don't gate anything.
 *
 * Only the thresholds you set are checked, and this object **replaces** nothing — there is no
 * default threshold to merge with. `{}` samples but can never throttle.
 *
 * Durations are **in seconds** and may be fractional: these are in-process sampling knobs, not
 * stored values, so a 200 ms event-loop threshold (`0.2`) is both meaningful and expected.
 */
export interface SystemLimiterOptions {
  /** How often pressure is sampled, **in seconds** (default 2). */
  sampleIntervalSeconds?: number;
  /**
   * Mean event-loop delay that counts as pressure, **in seconds** — e.g. `0.2` for 200 ms. The best
   * single signal that the process is saturated, and the only metric that isn't measured at all
   * until you set a threshold for it (it needs a `perf_hooks` histogram kept enabled).
   */
  maxEventLoopDelaySeconds?: number;
  /**
   * This process's CPU above this share of **all the cores available to it** counts as pressure
   * (0-100). Machine-relative, so the same `85` means the same thing on a 2-core container and a
   * 64-core box.
   */
  maxCpuPercent?: number;
  /**
   * This process's used heap above this share of V8's heap limit counts as pressure (0-100). The
   * limit is what `--max-old-space-size` sets, not machine RAM.
   */
  maxMemoryPercent?: number;
}

/**
 * The paging window every list read accepts. One shape for all of them, so `limit`/`offset` mean
 * the same thing wherever they appear and no read grows a second way to ask for a page.
 */
export interface PageQuery {
  /** Rows to return (default 50, capped at 500). */
  limit?: number;
  /** Row offset for numbered pagination. */
  offset?: number;
}

/**
 * One page of an offset-paged read. There is no `hasMore` flag: a caller who wants one derives it
 * from `offset + items.length < total`, and one number can't disagree with itself the way two can.
 */
export interface Page<T> {
  items: T[];
  /** Total rows matching the query, ignoring `limit`/`offset`. */
  total: number;
}
