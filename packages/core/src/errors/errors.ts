import { PortQueueErrorCode } from './error-codes.enum';

/** Typed details attached to an error. */
export interface ErrorContext {
  queue?: string;
  jobId?: string;
  scheduleId?: string;
  capability?: string;
  engine?: string;
  expectedVersion?: number;
  actualVersion?: number;
  [key: string]: unknown;
}

export interface PortQueueErrorOptions {
  code: PortQueueErrorCode;
  context?: ErrorContext;
  cause?: unknown;
}

/**
 * Base error for everything the public surface throws. Carries an
 * enum `code`, typed `context`, and `cause`. Messages must state what/why/how-to-fix.
 */
export class PortQueueError extends Error {
  readonly code: PortQueueErrorCode;
  readonly context: ErrorContext;

  constructor(message: string, options: PortQueueErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code;
    this.context = options.context ?? {};
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a method that needs a live connection is called before `init()`.
 *
 * Every public producing, consuming and reading method guards on this, so "I forgot to await
 * `init()`" surfaces as this message rather than as whatever the driver says about not being
 * connected.
 */
export class NotStartedError extends PortQueueError {
  constructor(method: string, context?: ErrorContext) {
    super(
      `Cannot call \`${method}\` before PortQueue has started. Call \`await pq.init()\` first — ` +
        `it connects the driver, applies migrations and starts the workers.`,
      { code: PortQueueErrorCode.NOT_STARTED, ...(context ? { context } : {}) },
    );
  }
}

export class InvalidOptionsError extends PortQueueError {
  constructor(message: string, context?: ErrorContext, cause?: unknown) {
    super(message, {
      code: PortQueueErrorCode.INVALID_OPTIONS,
      ...(context ? { context } : {}),
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

export class UnsupportedCapabilityError extends PortQueueError {
  constructor(capability: string, workaround: string, context?: ErrorContext) {
    super(`The configured driver does not support the '${capability}' capability. ${workaround}`, {
      code: PortQueueErrorCode.UNSUPPORTED_CAPABILITY,
      context: { capability, ...context },
    });
  }
}

export class SchemaVersionMismatchError extends PortQueueError {
  constructor(actual: number | null, expected: number, context?: ErrorContext) {
    super(
      `Database schema is at version ${actual ?? 0} but this @portqueue/core expects version ${expected}. ` +
        `Run 'npx portqueue migrate' (or set migration: MigrationMode.AUTO). ` +
        `Startup aborted because migration mode is VALIDATE_ONLY.`,
      {
        code: PortQueueErrorCode.SCHEMA_VERSION_MISMATCH,
        context: { actualVersion: actual ?? 0, expectedVersion: expected, ...context },
      },
    );
  }
}

export class MigrationFailedError extends PortQueueError {
  constructor(message: string, cause?: unknown, context?: ErrorContext) {
    super(message, {
      code: PortQueueErrorCode.MIGRATION_FAILED,
      ...(context ? { context } : {}),
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

export class DriverConnectionError extends PortQueueError {
  constructor(message: string, cause?: unknown, context?: ErrorContext) {
    super(message, {
      code: PortQueueErrorCode.DRIVER_CONNECTION_ERROR,
      ...(context ? { context } : {}),
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

export class DriverQueryError extends PortQueueError {
  constructor(message: string, cause?: unknown, context?: ErrorContext) {
    super(message, {
      code: PortQueueErrorCode.DRIVER_QUERY_ERROR,
      ...(context ? { context } : {}),
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

/**
 * Thrown when an **admin** client (the dashboard or the CLI, constructed with `_headless`) is asked
 * to produce onto a queue that has no row yet. A headless client never writes a queue row: creating
 * one is the application's declaration of intent, made with `createQueue`, and an admin tool
 * inventing queues would put rows in the database for names that no code consumes.
 */
export class QueueNotFoundError extends PortQueueError {
  constructor(queue: string) {
    super(
      `Queue '${queue}' does not exist. This client is headless (the dashboard or CLI), and a ` +
        `headless client never creates queues — declare it in your application with ` +
        `\`pq.createQueue({ name: '${queue}' })\` first.`,
      { code: PortQueueErrorCode.QUEUE_NOT_FOUND, context: { queue } },
    );
  }
}

/**
 * Thrown by {@link PortQueue.cancelJob} for an id that names no row.
 *
 * The one place a missing job is an error rather than a return value. `cancelJob` answers with what
 * it *did* — cancelled the row, or only signalled a running handler — and "there was nothing to
 * cancel" is not one of those answers. Every other by-id operation still reports a stale id as
 * `null`/`false`, so a batch can skip it.
 */
export class JobNotFoundError extends PortQueueError {
  constructor(jobId: string) {
    super(
      `Job '${jobId}' does not exist, so there was nothing to cancel. Its row may have been ` +
        `removed, or deleted by retention.`,
      { code: PortQueueErrorCode.JOB_NOT_FOUND, context: { jobId } },
    );
  }
}

export class QueuePausedError extends PortQueueError {
  constructor(queue: string) {
    super(
      `Queue '${queue}' is paused with PauseMode.ALL and is refusing new jobs. ` +
        `Resume it with pq.resumeQueue({ queue }) (or the dashboard/CLI) to accept jobs again.`,
      { code: PortQueueErrorCode.QUEUE_PAUSED, context: { queue } },
    );
  }
}

export class QueueInUseError extends PortQueueError {
  constructor(queue: string) {
    super(
      `Queue '${queue}' is still declared in this process (createQueue) and cannot ` +
        `be removed. Removal is a manual admin action for queues no longer used by any running ` +
        `code — stop referencing it everywhere first. The tool never removes queues on its own.`,
      { code: PortQueueErrorCode.QUEUE_IN_USE, context: { queue } },
    );
  }
}

export class InstanceActiveError extends PortQueueError {
  constructor(instanceKey: string) {
    super(
      `Instance '${instanceKey}' is still active (heartbeat within the last 30 minutes) and cannot ` +
        `be removed. Only long-inactive instances can be removed from monitoring; wait until it ` +
        `has not been seen for 30 minutes.`,
      { code: PortQueueErrorCode.INSTANCE_ACTIVE, context: { instanceKey } },
    );
  }
}

export class ShutdownTimeoutError extends PortQueueError {
  constructor(timeoutSeconds: number) {
    super(
      `Graceful shutdown timed out after ${timeoutSeconds}s; in-flight handlers were aborted and their locks released for reclaim.`,
      { code: PortQueueErrorCode.SHUTDOWN_TIMEOUT },
    );
  }
}

/**
 * A handler finished, but the job's row was no longer its to settle: the lock had lapsed and another
 * worker reclaimed the row, so the outcome was refused rather than written over the new run's.
 *
 * Surfaced on the `ERROR` event, never thrown at a caller — the handler itself did nothing wrong,
 * and the job is already running (or has already run) somewhere else. Seeing this repeatedly means
 * handlers are outliving their `lockDurationSeconds`.
 */
export class LockLostError extends PortQueueError {
  constructor(jobId: string, queue: string) {
    super(
      `Job '${jobId}' on queue '${queue}' finished after its claim was lost, so its outcome was not ` +
        `recorded — another worker had already reclaimed the row. Raise \`lockDurationSeconds\` for ` +
        `this queue, or make the handler observe \`job.signal\`.`,
      { code: PortQueueErrorCode.LOCK_LOST, context: { jobId, queue } },
    );
  }
}

export class MissingPeerDependencyError extends PortQueueError {
  constructor(pkg: string, driver: string) {
    super(
      `The ${driver} driver requires the '${pkg}' package. Install it with \`npm install ${pkg}\`.`,
      { code: PortQueueErrorCode.MISSING_PEER_DEPENDENCY, context: { engine: driver } },
    );
  }
}
