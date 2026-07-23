import type { JobOptions } from './job-options';
import type { RetentionOptions } from './common';
import type { HookRegistration } from '../events/hooks';

/**
 * Queue-definition options. Defaults for its jobs + queue-level policy.
 * These live in-memory on the instance; only the pause flags are ever persisted.
 */
export interface QueueOptions {
  /** Defaults every job on this queue inherits (a per-job option overrides). */
  defaultJobOptions?: JobOptions;
  /** Queue default retention; resolved per-job and frozen onto each row. */
  retention?: RetentionOptions;
  /** Queue-scoped participation hooks. */
  hooks?: HookRegistration[];
}
