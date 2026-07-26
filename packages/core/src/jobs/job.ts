/**
 * The runtime view of a job handed to a handler. Read-only fields
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
  /** Aborts on graceful-shutdown timeout / cooperative cancel. */
  readonly signal: AbortSignal;
  /**
   * Manually extend the visibility timeout for a long unit of work. `bySeconds` defaults to the
   * worker's `limiter.lockDurationSeconds`.
   */
  extendLock(options?: { bySeconds?: number }): Promise<void>;
}

/** A single-function job handler. */
export type JobHandler<TData = unknown, TResult = unknown> = (
  job: Job<TData>,
) => Promise<TResult> | TResult;
