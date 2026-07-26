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

export class NotStartedError extends PortQueueError {
  constructor(context?: ErrorContext) {
    super(
      'PortQueue has not been started. Call `await pq.init()` before producing or consuming jobs.',
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

export class JobNotFoundError extends PortQueueError {
  constructor(jobId: string) {
    super(`No job found with id '${jobId}'.`, {
      code: PortQueueErrorCode.JOB_NOT_FOUND,
      context: { jobId },
    });
  }
}

export class QueuePausedError extends PortQueueError {
  constructor(queue: string) {
    super(
      `Queue '${queue}' is paused with PauseMode.ALL and is refusing new jobs. ` +
        `Resume it with queue.resume() (or dashboard/CLI) to accept jobs again.`,
      { code: PortQueueErrorCode.QUEUE_PAUSED, context: { queue } },
    );
  }
}

export class QueueInUseError extends PortQueueError {
  constructor(queue: string) {
    super(
      `Queue '${queue}' is still registered in this process (createQueue/createWorker) and cannot ` +
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

export class MissingPeerDependencyError extends PortQueueError {
  constructor(pkg: string, driver: string) {
    super(
      `The ${driver} driver requires the '${pkg}' package. Install it with \`npm install ${pkg}\`.`,
      { code: PortQueueErrorCode.MISSING_PEER_DEPENDENCY, context: { engine: driver } },
    );
  }
}
