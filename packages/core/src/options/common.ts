import type { Duration } from '../util/duration.js';
import { BackoffStrategy, RetentionMode } from './enums.js';
import type { JobStatus } from '../jobs/job-state.enum.js';

/** Exponential/fixed backoff configuration. */
export interface BackoffOptions {
  strategy: BackoffStrategy;
  /** Growth factor for EXPONENTIAL (default 2); ignored for FIXED. */
  factor?: number;
  /** Cap on the computed delay. */
  maxDelay?: Duration;
  /** Apply jitter to spread retries across instances. */
  jitter?: boolean;
}

/** Retention policy. Default is keep-forever. */
export interface RetentionOptions {
  mode: RetentionMode;
  /** How long after finishing before deletion is allowed (required for DELETE_AFTER). */
  ttl?: Duration;
  /** Which finished statuses the policy applies to (default: [COMPLETED]). */
  statuses?: JobStatus[];
}

/** Token-bucket rate limiter config. */
export interface RateLimiterOptions {
  max: number;
  duration: Duration;
}

/** Opaque developer metadata for correlation/tracing. */
export type JobMetadata = Record<string, unknown>;

/** Override auto-detected instance identity. */
export interface InstanceIdentityOptions {
  id?: string;
  type?: import('./enums.js').InstanceType;
  /** Path to persist a generated bare-metal id. */
  persistPath?: string;
}

/** System-pressure backpressure config. */
export interface SystemMonitorOptions {
  sampleIntervalMs?: number;
  maxEventLoopDelayMs?: number;
  maxCpuPercent?: number;
  maxMemoryPercent?: number;
  maxRssBytes?: number;
  /** Fraction (0-1) below the threshold metrics must fall to before resuming. */
  resumeHysteresis?: number;
}

/** Cursor-based page result. */
export interface Page<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
}
