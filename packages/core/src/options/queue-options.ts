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

/** What `pq.createQueue({ … })` takes: the queue's name plus its definition options. */
export interface CreateQueueOptions<TName extends string = string> extends QueueOptions {
  /** The queue name — the key every job, worker and schedule on it is filed under. */
  name: TName;
}
