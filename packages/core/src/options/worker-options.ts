import type { JobHandler } from '../jobs/job';
import type { LimiterOptions } from './common';

/** An error constructor for `dontAutoretryFor` matching. */
export type ErrorClass = new (...args: never[]) => Error;

/**
 * Consumer-only options. Never contains job/priority/delay fields.
 */
export interface WorkerOptions<
  TData = unknown,
  TResult = unknown,
  TQueues extends string = string,
> {
  queue: TQueues;
  /** The single-function processor for this queue's jobs. */
  handler: JobHandler<TData, TResult>;
  /**
   * Worker throughput & claim tuning in one group: `concurrency`, `rate`, `respectSystemPressure`,
   * `batchSize`, `pollIntervalMs`, and `lockDurationMs`. Omit it for sensible defaults.
   */
  limiter?: LimiterOptions;
  /** Celery-style non-retryable errors — matched by `instanceof` or `error.name`. */
  dontAutoretryFor?: Array<ErrorClass | string>;
}
