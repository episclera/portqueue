import type { Duration } from '../util/duration.js';
import { BackoffStrategy, RetentionMode } from './enums.js';
import type { JobStatus } from '../jobs/job-state.enum.js';

/** Exponential/fixed backoff configuration (build_plan/05.6). */
export interface BackoffOptions {
  strategy: BackoffStrategy;
  /** Growth factor for EXPONENTIAL (default 2); ignored for FIXED. */
  factor?: number;
  /** Cap on the computed delay. */
  maxDelay?: Duration;
  /** Apply jitter to spread retries across instances. */
  jitter?: boolean;
}

/** Retention policy (build_plan/06.9). Default is keep-forever. */
export interface RetentionOptions {
  mode: RetentionMode;
  /** How long after finishing before deletion is allowed (required for DELETE_AFTER). */
  ttl?: Duration;
  /** Which finished statuses the policy applies to (default: [COMPLETED]). */
  statuses?: JobStatus[];
}

/** Token-bucket rate limiter config (build_plan/07.4). */
export interface RateLimiterOptions {
  max: number;
  duration: Duration;
}

/** Opaque developer metadata for correlation/tracing (build_plan/05.6). */
export type JobMetadata = Record<string, unknown>;

/** Override auto-detected instance identity (build_plan/07.3). */
export interface InstanceIdentityOptions {
  id?: string;
  type?: import('./enums.js').InstanceType;
  /** Path to persist a generated bare-metal id (build_plan/07.3). */
  persistPath?: string;
}

/** System-pressure backpressure config (build_plan/07.5). */
export interface SystemMonitorOptions {
  sampleIntervalMs?: number;
  maxEventLoopDelayMs?: number;
  maxCpuPercent?: number;
  maxMemoryPercent?: number;
  maxRssBytes?: number;
  /** Fraction (0-1) below the threshold metrics must fall to before resuming. */
  resumeHysteresis?: number;
}

/** Cursor-based page result (build_plan/05.2). */
export interface Page<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
}
