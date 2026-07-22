import type { JobHandler, WorkflowStep } from '../jobs/job.js';
import type { RateLimiterOptions } from './common.js';

/** An error constructor for `dontAutoretryFor` matching (build_plan/05.4). */
export type ErrorClass = new (...args: never[]) => Error;

/**
 * Consumer-only options (build_plan/05.4). Never contains job/priority/delay fields.
 *
 * `handler` is the processor in one of two modes:
 * - **simple** — a single {@link JobHandler} function, or
 * - **workflow** — an ordered array of {@link WorkflowStep}s (array order is the
 *   canonical step sequence). A multi-step job is just a worker whose handler is an array;
 *   there is no separate workflow-definition object.
 */
export interface WorkerOptions<
  TData = unknown,
  TResult = unknown,
  TQueues extends string = string,
> {
  queue: TQueues;
  /**
   * Single-function processor (simple mode) or an ordered array of workflow steps
   * (workflow mode). The array order is the canonical step sequence.
   */
  handler: JobHandler<TData, TResult> | ReadonlyArray<WorkflowStep<TData>>;
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
