import type { JobMetadata } from '../options/common.js';

/**
 * The runtime view of a job handed to a handler (build_plan/05.5). Read-only fields
 * plus a couple of control methods. This is NOT how you construct jobs.
 */
export interface Job<TData = unknown> {
  readonly id: string;
  readonly queue: string;
  readonly data: TData;
  readonly retryAttempt: number;
  readonly retryMaxAttempts: number;
  readonly priority: number;
  readonly createdAt: Date;
  readonly startAfter: Date;
  readonly scheduleId?: string;
  readonly idempotencyKey?: string;
  readonly workflowId?: string;
  readonly workflowStepKey?: string;
  readonly metadata: JobMetadata;
  /** Aborts on graceful-shutdown timeout / cooperative cancel (build_plan/07.6). */
  readonly signal: AbortSignal;
  /** Manually extend the visibility timeout for a long unit of work. */
  extendLock(options?: { byMs?: number }): Promise<void>;
}

/** A single-function job handler (build_plan/05.4). */
export type JobHandler<TData = unknown, TResult = unknown> = (
  job: Job<TData>,
) => Promise<TResult> | TResult;

/** A workflow step handler (build_plan/05.4 / 06.8). Transitions live on the `step` controller. */
export type StepHandler<TData = unknown> = (
  job: Job<TData>,
  step: StepController,
) => Promise<StepOutcome> | StepOutcome;

/**
 * The controller passed as the second argument to a step handler. Every outcome is a
 * named-options call and completes this step's job (spawning the next except for `done`).
 */
export interface StepController {
  /** Advance to the next step (default: next in declared order) or jump via `to`. */
  next(options?: { to?: string; data?: unknown }): StepOutcome;
  /** Re-run the same step, optionally delayed. */
  repeat(options?: { data?: unknown; delayMs?: number }): StepOutcome;
  /** Finish the whole run; spawns nothing. */
  done(options?: { result?: unknown }): StepOutcome;
}

/** Discriminated outcome of a step handler. */
export type StepOutcome =
  | { readonly kind: 'next'; readonly to?: string; readonly data?: unknown }
  | { readonly kind: 'repeat'; readonly data?: unknown; readonly delayMs?: number }
  | { readonly kind: 'done'; readonly result?: unknown };

/** One declared step of a workflow (build_plan/05.4). */
export interface WorkflowStep<TData = unknown> {
  key: string;
  handler: StepHandler<TData>;
}

/**
 * A pure, shared workflow definition (build_plan/05.3). Imported by both the producer
 * (`pq.createQueue(def)`) and worker (`pq.createWorker(def)`) tiers.
 */
export interface WorkflowDefinition<TData = unknown, TQueue extends string = string> {
  readonly queue: TQueue;
  readonly steps: ReadonlyArray<WorkflowStep<TData>>;
  readonly entryStep: string;
}
