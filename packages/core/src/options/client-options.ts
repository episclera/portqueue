import type { Driver } from '../drivers/driver.interface';
import type { Logger, LoggerOptions } from '../logging/logger.interface';
import type { MigrationMode } from './enums';
import type { SystemMonitorOptions } from './common';

/** How this process's data is laid out in the shared database. */
export interface StorageOptions {
  /** DB schema/namespace (Postgres/Oracle). */
  schema?: string;
  /** Prefix for all created tables (default 'pq_'). */
  tablePrefix?: string;
  /** Logical prefix for pub/sub channels when multiple PortQueues share one DB. */
  namespace?: string;
}

/**
 * This process's instance identity. Provide a `key` to name the instance so it can be targeted:
 * it registers a heartbeat row, honours job affinity (`preferredInstanceKeyPattern`), appears in
 * the instances list, and can be paused on its own. Never auto-detected from the environment.
 */
export interface InstanceOptions {
  /**
   * Stable, human-meaningful id for this process (e.g. `'worker-eu-1'` or `'host-3:ram-8gb:cpu-4'`).
   * Leave unset to stay anonymous — the process still runs jobs, but can't be targeted or listed.
   */
  key?: string;
  /** Lock-owner attribution id. Defaults to a random per-process token; never auto-detected. */
  id?: string;
  /** Heartbeat cadence for the instance row's `last_seen_at` (ms). Default 15000. */
  heartbeatIntervalMs?: number;
}

/** Top-level client options. Construction wires DI only — no I/O. */
export interface PortQueueOptions {
  /** A driver instance (from a subpath import or a custom one). Required. */
  driver: Driver;
  logger?: Logger | LoggerOptions;
  migration?: MigrationMode;
  /** DB storage layout: schema, table prefix, and pub/sub namespace. */
  storage?: StorageOptions;
  /** This process's instance identity & multi-instance settings. */
  instance?: InstanceOptions;
  /** System-pressure backpressure; `false` disables. */
  monitor?: SystemMonitorOptions | false;
  /** Interval for scheduler/retention/monitor ticks (ms). Default 5000. */
  tickIntervalMs?: number;
  /** @internal Inject a clock for deterministic tests. */
  clock?: import('../util/clock').Clock;
}

/** Options for `pq.shutdown`. */
export interface ShutdownOptions {
  graceful?: boolean;
  timeoutMs?: number;
  drain?: boolean;
}
