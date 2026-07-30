/** Worker throughput and claim defaults. Durations are **in seconds**. */

/** Handlers a worker runs at once. `LimiterOptions.concurrency`. */
export const DEFAULT_CONCURRENCY = 1;

/**
 * Poll cadence when nothing wakes the worker. LISTEN/NOTIFY engines wake instantly and only fall
 * back to this as a safety net; non-notify engines poll on it. `LimiterOptions.pollIntervalSeconds`.
 */
export const DEFAULT_POLL_INTERVAL_SECONDS = 5;

/** Visibility timeout / heartbeat window for a claimed job. `LimiterOptions.lockDurationSeconds`. */
export const DEFAULT_LOCK_DURATION_SECONDS = 30;

/** Beats per lock window — a job's lock is extended this many times before it would lapse. */
export const LOCK_HEARTBEATS_PER_WINDOW = 3;

/** The fastest a lock heartbeat ever beats, whatever the lock window. */
export const MIN_LOCK_HEARTBEAT_SECONDS = 1;

/** How often a graceful drain re-checks whether the last handler has finished. */
export const DRAIN_POLL_SECONDS = 0.025;
