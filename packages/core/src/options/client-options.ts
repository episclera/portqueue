import type { Driver } from '../drivers/driver.interface';
import type { Logger, LoggerOptions } from '../logging/logger.interface';
import type { MigrationMode } from './enums';
import type { JobOptions } from './job-options';
import type { InstanceIdentityOptions, RetentionOptions, SystemMonitorOptions } from './common';

/** Top-level client options. Construction wires DI only — no I/O. */
export interface PortQueueOptions<TInstanceKey extends string = string> {
  /** A driver instance (from a subpath import or a custom one). Required. */
  driver: Driver;
  logger?: Logger | LoggerOptions;
  /** DB schema/namespace (Postgres/Oracle). */
  schema?: string;
  /** Prefix for all created tables (default 'pq_'). */
  tablePrefix?: string;
  migration?: MigrationMode;
  /** Client-wide job defaults (lowest precedence). */
  defaultJobOptions?: JobOptions;
  /** System-pressure backpressure; `false` disables. */
  monitor?: SystemMonitorOptions | false;
  /** Client-wide default retention. */
  retention?: RetentionOptions;
  /** Reject addJob when serialized `data` exceeds this (default 1 MiB). */
  maxPayloadBytes?: number;
  /** Auto-detected process identity override (lock-owner attribution). */
  instance?: InstanceIdentityOptions;
  /**
   * Opt into **multi-instance mode**. A stable, human-meaningful key for
   * this instance (e.g. `'worker-eu-1'` or `'host-3:ram-8gb:cpu-4'`). When set, this instance
   * registers a heartbeat row, honours job affinity (`preferredInstanceKeyPattern`), and can be
   * paused independently from the dashboard. Leave unset to run in single-instance mode.
   */
  instanceKey?: TInstanceKey;
  /** Heartbeat cadence for the instance row's `last_seen_at` (ms). Default 15000. */
  instanceHeartbeatIntervalMs?: number;
  /** Logical prefix for pub/sub channels when multiple PortQueues share one DB. */
  namespace?: string;
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
