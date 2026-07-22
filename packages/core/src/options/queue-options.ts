import type { JobOptions } from './job-options.js';
import type { RateLimiterOptions, RetentionOptions } from './common.js';
import type { HookRegistration } from '../events/hooks.js';

/**
 * Queue-definition options (build_plan/05.6). Defaults for its jobs + queue-level policy.
 * These live in-memory on the instance; only the pause flags are ever persisted (04.3).
 */
export interface QueueOptions {
  /** Defaults every job on this queue inherits (a per-job option overrides). */
  defaultJobOptions?: JobOptions;
  /** Queue default retention; resolved per-job and frozen onto each row. */
  retention?: RetentionOptions;
  /** Cluster-wide cap on job starts (distinct from a worker's local limiter). */
  rateLimit?: RateLimiterOptions;
  /** Whether priority ordering is honored (default true). */
  priorityEnabled?: boolean;
  /** Reject jobs whose serialized payload exceeds this many bytes. */
  maxPayloadBytes?: number;
  /** Queue-scoped participation hooks. */
  hooks?: HookRegistration[];
}
