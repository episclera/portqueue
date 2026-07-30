import type { Driver } from '../drivers/driver.interface';
import type { Logger, LoggerOptions } from '../logging/logger.interface';
import type { MigrationMode } from './enums';
import type { SystemLimiterOptions } from './common';

/**
 * This process's instance identity. Provide an `instanceKey` to name the instance so it can be
 * targeted: it registers a heartbeat row, honours job affinity (`preferredInstanceKeyPattern`),
 * appears in the instances list, and can be paused on its own. Never auto-detected from the
 * environment.
 */
export interface InstanceOptions {
  /**
   * Stable, human-meaningful name for this process (e.g. `'worker-eu-1'` or `'host-3:ram-8gb:cpu-4'`).
   * Leave unset to stay anonymous — the process still runs jobs, but can't be targeted or listed.
   */
  instanceKey?: string;
  /** Heartbeat cadence for the instance row's `last_seen_at`, **in seconds**. Default 15. */
  heartbeatIntervalSeconds?: number;
}

/** Top-level client options. Construction wires DI only — no I/O. */
export interface PortQueueOptions {
  /** A driver instance (from a subpath import or a custom one). Required. */
  driver: Driver;
  logger?: Logger | LoggerOptions;
  migration?: MigrationMode;
  /** This process's instance identity & multi-instance settings. */
  instance?: InstanceOptions;
  /**
   * Thresholds on this process's own CPU / memory / event-loop that pause job claiming while
   * breached ({@link SystemLimiterOptions}). Omitted by default — nothing throttles unless you
   * define it. This process's health is measured either way; only the throttling is opt-in.
   */
  systemLimiter?: SystemLimiterOptions;
  /** Interval for scheduler/retention/monitor ticks, **in seconds**. Default 5. */
  tickIntervalSeconds?: number;
  /**
   * Mark this client as an **admin client** rather than an application one. Set by
   * `@portqueue/dashboard`'s `createDashboard({ driver })` and by `@portqueue/cli`; an application
   * never sets it.
   *
   * A headless client observes and administers a PortQueue deployment without joining it:
   *
   * - `createQueue` declares nothing and creates no row — it only hands back a typed name. Producing
   *   onto a queue that has no row throws `QueueNotFoundError` rather than inventing the queue.
   * - It registers **no instance row** and rejects an `instance.instanceKey`, so an admin process
   *   never appears in the instances list or claims affinity-targeted work.
   * - It runs no workers, no scheduler, no retention sweep and no health monitor — an admin tool must
   *   not quietly become a second producer of the cluster's scheduled work.
   * - `migration` defaults to `MANUAL`, so pointing a dashboard at a database never migrates it as a
   *   side effect. (The CLI's `migrate` command applies them explicitly.)
   *
   * @internal Documented in the API reference for completeness; not part of the application surface.
   */
  _headless?: boolean;
  /** @internal Inject a clock for deterministic tests. */
  clock?: import('../util/clock').Clock;
}

/** Options for `pq.shutdown`. */
export interface ShutdownOptions {
  /**
   * Wait for in-flight handlers to finish before aborting them (default true). With `false` every
   * running handler is aborted immediately and its lock released for fast reclaim.
   */
  graceful?: boolean;
  /** How long to wait for in-flight handlers and background work, **in seconds**. Default 30. */
  timeoutSeconds?: number;
}
