import type { JobHandler, WorkflowStep } from '../jobs/job.js';
import type { RateLimiterOptions } from './common.js';

/** An error constructor for `dontAutoretryFor` matching (build_plan/05.4). */
export type ErrorClass = new (...args: never[]) => Error;

/**
 * Consumer-only options (build_plan/05.4). Never contains job/priority/delay fields.
 * Exactly one of `handler` or `steps` must be provided.
 */
export interface WorkerOptions<
  TData = unknown,
  TResult = unknown,
  TQueues extends string = string,
> {
  queue: TQueues;
  /** Single-function processor. */
  handler?: JobHandler<TData, TResult>;
  /** Ordered workflow steps (multi-step job); the array order is the canonical sequence. */
  steps?: ReadonlyArray<WorkflowStep<TData>>;
  concurrency?: number;
  /** Worker-local (exact, in-process) token-bucket limiter. */
  limiter?: RateLimiterOptions;
  batchSize?: number;
  pollIntervalMs?: number;
  lockDurationMs?: number;
  respectSystemPressure?: boolean;
  /** Celery-style non-retryable errors — matched by `instanceof` or `error.name`. */
  dontAutoretryFor?: Array<ErrorClass | string>;
}
