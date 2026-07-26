import { BackoffStrategy, RetentionMode } from './enums';
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

/** Retention policy. Default is keep-forever. */
export interface RetentionOptions {
  mode: RetentionMode;
  /**
   * How long after finishing before deletion is allowed, in **whole seconds** (required for
   * DELETE_AFTER).
   */
  ttlSeconds?: number;
  /** Which finished statuses the policy applies to (default: [COMPLETED]). */
  statuses?: JobStatus[];
}

/**
 * Everything that tunes a worker's throughput, grouped in one place: how many jobs run and are
 * claimed at once, how often it polls, the lock window, the rate cap, and system-pressure
 * backpressure. Omit the whole group to run with sensible defaults (unbounded rate, concurrency 1).
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
  /**
   * Pause claiming while system pressure (CPU/memory/event-loop) is high. Default `false` —
   * the worker consumes as much as it can; opt in to trade throughput for stability.
   */
  respectSystemPressure?: boolean;
  /** Max jobs claimed per fetch (defaults to `concurrency`). */
  batchSize?: number;
  /** Poll cadence when LISTEN/NOTIFY is unavailable, **in seconds** (default 5). */
  pollIntervalSeconds?: number;
  /** Visibility timeout / heartbeat window for a claimed job, **in seconds** (default 30). */
  lockDurationSeconds?: number;
}

/**
 * System-pressure backpressure config. Durations are **in seconds**; these are in-process sampling
 * knobs rather than stored values, so sub-second values are allowed and expected.
 */
export interface SystemMonitorOptions {
  /** How often pressure is sampled, **in seconds** (default 2). */
  sampleIntervalSeconds?: number;
  /** Mean event-loop delay that counts as pressure, **in seconds** (default 0.2, i.e. 200 ms). */
  maxEventLoopDelaySeconds?: number;
  maxCpuPercent?: number;
  maxMemoryPercent?: number;
  maxRssBytes?: number;
  /** Fraction (0-1) below the threshold metrics must fall to before resuming. */
  resumeHysteresis?: number;
}

/** Page result — cursor for streaming, `total` for numbered pagination. */
export interface Page<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
  /** Total rows matching the query, ignoring `limit`/`offset`/`cursor`. */
  total: number;
}
