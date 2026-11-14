/** Retry backoff strategies. */
export enum BackoffStrategy {
  FIXED = 'FIXED',
  EXPONENTIAL = 'EXPONENTIAL',
}

/** How a queue is paused. */
export enum PauseMode {
  /** Workers stop claiming/running jobs, but the queue still accepts new adds. */
  PROCESSING = 'PROCESSING',
  /** Also refuse new jobs (drain/incident control). */
  ALL = 'ALL',
}

/** Why an add was deduplicated. */
export enum DeduplicationReason {
  IDEMPOTENCY = 'IDEMPOTENCY',
  SINGLETON = 'SINGLETON',
}

/**
 * What a `cancelJob` actually did. Three states rather than a boolean, because "asked to stop" and
 * "stopped" are not the same claim and a caller acting on the difference (reporting it, waiting for
 * it) needs to know which it got.
 */
export enum CancelOutcome {
  /** The row is now `CANCELLED`; the job will never run. */
  CANCELLED = 'CANCELLED',
  /**
   * The job is running in **this** process, so its handler's `AbortSignal` was fired. Cancellation
   * is cooperative: a handler that ignores `job.signal` runs to completion and the row ends
   * `COMPLETED`, so nothing has been cancelled yet.
   */
  SIGNALLED = 'SIGNALLED',
  /**
   * The job exists but was not cancellable: it has already finished, or it is `ACTIVE` in another
   * process — which only that process can signal.
   */
  NOT_CANCELLABLE = 'NOT_CANCELLABLE',
}

/**
 * What a plural method (`cancelJobs`, `pauseQueues`, `removeInstances`, …) did with **one** of the
 * ids or names it was given. A batch skips what it cannot act on rather than failing, so every item
 * reports its own outcome and one stale id never hides what happened to the rest.
 */
export enum BatchItemOutcome {
  /** The action took effect on this item. */
  APPLIED = 'APPLIED',
  /**
   * `cancelJobs` only: the job is running in **this** process, so its handler's `AbortSignal` was
   * fired. Same meaning as {@link CancelOutcome.SIGNALLED} — nothing has been cancelled yet.
   */
  SIGNALLED = 'SIGNALLED',
  /**
   * The item exists but the action does not apply to it right now: a running job for
   * `retryJobs`, an already-settled (or elsewhere-running) job for `cancelJobs`, an instance seen
   * too recently for `removeInstances`.
   */
  REFUSED = 'REFUSED',
  /** No row carries this id or name. */
  NOT_FOUND = 'NOT_FOUND',
}

/** Auto-migration behavior on init. */
export enum MigrationMode {
  AUTO = 'AUTO',
  MANUAL = 'MANUAL',
  VALIDATE_ONLY = 'VALIDATE_ONLY',
}

/** Database engines a driver can advertise. */
export enum DatabaseEngine {
  POSTGRESQL = 'POSTGRESQL',
  PGLITE = 'PGLITE',
  SQLITE = 'SQLITE',
  ORACLE = 'ORACLE',
  MYSQL = 'MYSQL',
  CUSTOM = 'CUSTOM',
}

/**
 * How much of a handler's failure is kept on the job row (`createQueue({ failureDetail })`).
 *
 * Not a boolean, because "store the stack" and "store the message" are two named policies an
 * operator chooses between, and a `storeStack: false` reads as a workaround rather than a decision.
 */
export enum FailureDetail {
  /** `error.stack` — the throw site and the frames around it, truncated. The default. */
  STACK = 'STACK',
  /** `Error: message` only. For a queue that fails often, where the frames are noise and bytes. */
  MESSAGE = 'MESSAGE',
}
