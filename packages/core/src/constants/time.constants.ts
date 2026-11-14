/**
 * Default cadences and time windows, all **in seconds** (the only unit the API speaks).
 *
 * Every default lives in `constants/` rather than inline at its use site so there is exactly one
 * place to change a policy — the heartbeat window in particular was previously copied into four
 * files that could drift apart.
 */

/** The IANA timezone a cron schedule is evaluated in when its `CronSpec` names none. */
export const DEFAULT_CRON_TIMEZONE = 'UTC';

/** Maintenance tick (scheduler + retention + expiry) cadence. `PortQueueOptions.tickIntervalSeconds`. */
export const DEFAULT_TICK_INTERVAL_SECONDS = 5;

/** The floor the pub/sub poller falls back to when the tick interval is shorter. */
export const MIN_SUBSCRIBER_POLL_SECONDS = 5;

/** Instance heartbeat cadence. `InstanceOptions.heartbeatIntervalSeconds`. */
export const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 15;

/**
 * How many missed heartbeats an instance may accumulate before it reads as stale. Three, so a
 * single slow beat (a long query, a GC pause) never flips a healthy instance to "stale".
 */
export const HEARTBEAT_STALE_BEATS = 3;

/** How long an instance must have been unheard-from before it can be manually removed. */
export const INSTANCE_REMOVAL_STALE_SECONDS = 30 * 60;

/** Graceful-shutdown budget for in-flight handlers and background work. `ShutdownOptions.timeoutSeconds`. */
export const DEFAULT_SHUTDOWN_TIMEOUT_SECONDS = 30;

/** Health sampling cadence. `SystemLimiterOptions.sampleIntervalSeconds`. */
export const DEFAULT_SAMPLE_INTERVAL_SECONDS = 2;

/** How long a migration runner waits for another instance to finish migrating. */
export const MIGRATION_WAIT_TIMEOUT_SECONDS = 30;

/**
 * Milliseconds → microseconds, for the one reading that is measured in microseconds: `cpuUsage()`.
 * Deliberately *not* in `util/seconds` — that module owns the seconds↔milliseconds boundary the API
 * invariant is about, and this is a different pair of units.
 */
export const MICROS_PER_MS = 1000;

/**
 * Milliseconds → nanoseconds, for the event-loop-delay histogram, which reports in nanoseconds. The
 * same reasoning as {@link MICROS_PER_MS}: the reading goes ns → ms here, then ms → seconds through
 * `util/seconds`.
 */
export const NANOS_PER_MS = 1_000_000;

/**
 * Sampling resolution of the event-loop-delay histogram, **in seconds** (20 ms). Fine enough to see
 * a stall worth throttling on, coarse enough that the histogram's own timer costs nothing.
 */
export const EVENT_LOOP_HISTOGRAM_RESOLUTION_SECONDS = 0.02;

/** How often that wait re-reads the applied schema version. */
export const MIGRATION_WAIT_POLL_SECONDS = 0.2;
