import type { JobOptions } from './job-options';
import type { LimiterOptions, RetentionOptions } from './common';
import type { HookRegistration } from '../events/hooks';
import type { JobHandler } from '../jobs/job';

/** An error constructor for `dontAutoretryFor` matching. */
export type ErrorClass = new (...args: never[]) => Error;

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

/**
 * What `pq.createQueue({ … })` takes: **everything about one queue, in one call** — its name, the
 * `handler` that processes its jobs, the settings that shape how it claims them, and the defaults,
 * retention policy and hooks its jobs inherit.
 *
 * The `handler` is **required**: declaring a queue *is* declaring that this process consumes it.
 * There is deliberately no processor-less declaration and no separate consumer registration — a queue
 * and its processor were never two independent things, and splitting them meant naming the same queue
 * twice in an order that mattered (the consumer captured the queue's declared options at creation, so
 * a declaration made afterwards was silently ignored).
 *
 * A process that only *enqueues* declares nothing at all: `pq.addJob({ queue, data })` addresses a
 * queue by name and creates its row on first use, so an API tier needs no handler to produce onto a
 * queue its worker tier consumes.
 */
export interface CreateQueueOptions<
  TData = unknown,
  TResult = unknown,
  TName extends string = string,
> extends QueueOptions {
  /** The queue name — the key every job, schedule and read on it is filed under. */
  name: TName;
  /**
   * The single-function processor for this queue's jobs. This process begins claiming as soon as the
   * client is running and the queue isn't paused, and stops on shutdown.
   */
  handler: JobHandler<TData, TResult>;
  /**
   * Throughput & claim tuning for this queue's processing, in one group: `concurrency`,
   * `rateMax`/`rateDurationSeconds`, `batchSize`, `pollIntervalSeconds` and `lockDurationSeconds`.
   * Every duration is in seconds. Omit it for sensible defaults. Whether processing pauses under
   * system pressure is not set here — it follows from `systemLimiter` on the PortQueue.
   */
  limiter?: LimiterOptions;
  /** Celery-style non-retryable errors — matched by `instanceof` or `error.name`. */
  dontAutoretryFor?: Array<ErrorClass | string>;
}
