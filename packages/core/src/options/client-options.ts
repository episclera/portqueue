import type { Driver } from '../driver/driver.interface.js';
import type { Logger, LoggerOptions } from '../logging/logger.interface.js';
import type { MigrationMode } from './enums.js';
import type { JobOptions } from './job-options.js';
import type { InstanceIdentityOptions, RetentionOptions, SystemMonitorOptions } from './common.js';

/** Top-level client options (build_plan/05.2). Construction wires DI only — no I/O. */
export interface PortQueueOptions {
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
  /** System-pressure backpressure (build_plan/07); `false` disables. */
  monitor?: SystemMonitorOptions | false;
  /** Client-wide default retention. */
  retention?: RetentionOptions;
  /** Reject addJob when serialized `data` exceeds this (default 1 MiB). */
  maxPayloadBytes?: number;
  instance?: InstanceIdentityOptions;
  /** Logical prefix for pub/sub channels when multiple PortQueues share one DB. */
  namespace?: string;
  /** Interval for scheduler/retention/monitor ticks (ms). Default 5000. */
  tickIntervalMs?: number;
  /** @internal Inject a clock for deterministic tests (build_plan/16.5). */
  clock?: import('../util/clock.js').Clock;
}

/** Options for `pq.shutdown` (build_plan/05.2). */
export interface ShutdownOptions {
  graceful?: boolean;
  timeoutMs?: number;
  drain?: boolean;
}
