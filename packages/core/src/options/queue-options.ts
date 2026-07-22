import type { JobOptions } from './job-options.js';
import type { RetentionOptions } from './common.js';
import type { HookRegistration } from '../events/hooks.js';

/**
 * Queue-definition options. Defaults for its jobs + queue-level policy.
 * These live in-memory on the instance; only the pause flags are ever persisted.
 */
export interface QueueOptions {
  /** Defaults every job on this queue inherits (a per-job option overrides). */
  defaultJobOptions?: JobOptions;
  /** Queue default retention; resolved per-job and frozen onto each row. */
  retention?: RetentionOptions;
  /** Whether priority ordering is honored (default true). */
  priorityEnabled?: boolean;
  /** Reject jobs whose serialized payload exceeds this many bytes. */
  maxPayloadBytes?: number;
  /** Queue-scoped participation hooks. */
  hooks?: HookRegistration[];
}
