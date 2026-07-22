import { JobStatus } from '../jobs/job-state.enum.js';
import { PortQueueEvent } from '../events/event-name.enum.js';
import { computeBackoffMs } from '../util/backoff.js';
import type { ErrorClass } from '../options/worker-options.js';
import type { JobRecord } from '../jobs/job-record.js';
import type { Runtime } from '../client/runtime.js';
import type { ProcessOutcome } from '../events/hooks.js';

/** Marks complete/failed/retry atomically and emits the matching event (build_plan/02.5). */
export class CompletionService {
  constructor(private readonly runtime: Runtime) {}

  async complete(
    record: JobRecord,
    queueName: string,
    returnValue: unknown,
    startTs: number,
  ): Promise<ProcessOutcome> {
    const now = this.runtime.clock.now();
    await this.runtime.driver.completeJob({ jobId: record.id, returnValue, now });
    this.runtime.events.emit(PortQueueEvent.JOB_COMPLETED, {
      jobId: record.id,
      queue: queueName,
      returnValue,
      durationMs: now - startTs,
    });
    return { kind: 'completed', returnValue };
  }

  /** Decide retry-vs-fail after a handler throw (build_plan/06.4). */
  async failOrRetry(
    record: JobRecord,
    queueName: string,
    error: unknown,
    dontAutoretryFor: Array<ErrorClass | string>,
  ): Promise<ProcessOutcome> {
    const now = this.runtime.clock.now();
    const message = errorToMessage(error);
    const attemptsMade = record.retryAttempt + 1;
    const nonRetryable = matchesNonRetryable(error, dontAutoretryFor);
    const canRetry = !nonRetryable && attemptsMade < record.retryMaxAttempts;

    if (canRetry) {
      const delay = computeBackoffMs({
        strategy: record.retryBackoff,
        attempt: attemptsMade,
        baseDelayMs: record.retryDelayMs,
        factor: record.retryBackoffFactor,
        maxDelayMs: record.retryMaxDelayMs,
        jitter: record.retryJitter,
      });
      const nextRunAt = now + delay;
      await this.runtime.driver.retryJob({
        jobId: record.id,
        nextRunAt,
        retryAttempt: attemptsMade,
        lastError: message,
        now,
      });
      this.runtime.events.emit(PortQueueEvent.JOB_RETRYING, {
        jobId: record.id,
        queue: queueName,
        retryAttempt: attemptsMade,
        nextRunAt: new Date(nextRunAt),
      });
      // Wake the loop; the claim query still gates on start_after so a delayed retry waits.
      this.runtime.wakeup.signal(queueName);
      return { kind: 'retry', error, nextRunAt: new Date(nextRunAt) };
    }

    await this.runtime.driver.failJob({ jobId: record.id, lastError: message, now });
    this.runtime.events.emit(PortQueueEvent.JOB_FAILED, {
      jobId: record.id,
      queue: queueName,
      error,
      retryAttempt: record.retryAttempt,
    });
    if (record.workflowId) {
      this.runtime.events.emit(PortQueueEvent.WORKFLOW_FAILED, {
        workflowId: record.workflowId,
        queue: queueName,
        stepKey: record.workflowStepKey ?? '',
        jobId: record.id,
        error,
      });
    }
    return { kind: 'failed', error };
  }
}

/** Normalize any thrown value to a message that includes the stack where available. */
export function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function matchesNonRetryable(error: unknown, list: Array<ErrorClass | string>): boolean {
  if (!list.length) return false;
  const name = error instanceof Error ? error.name : undefined;
  for (const entry of list) {
    if (typeof entry === 'string') {
      if (name === entry) return true;
    } else if (typeof entry === 'function' && error instanceof entry) {
      return true;
    }
  }
  return false;
}

export { JobStatus };
