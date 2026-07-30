import { JobStatus } from '../jobs/job-state.enum';
import { PortQueueEvent } from '../events/event-name.enum';
import { computeBackoffSeconds } from '../util/backoff';
import { msToSeconds, secondsToMs } from '../util/seconds';
import { FAILURE_MESSAGE_MAX_CHARS, FAILURE_MESSAGE_TRUNCATION_SUFFIX } from '../constants';
import type { ErrorClass } from '../options/worker-options';
import type { JobRecord } from '../jobs/job-record';
import type { Runtime } from '../client/runtime';
import type { ProcessOutcome } from '../events/hooks';

/** Marks complete/failed/retry atomically and emits the matching event. */
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
      durationSeconds: msToSeconds(now - startTs),
    });
    return { kind: 'completed', returnValue };
  }

  /** Decide retry-vs-fail after a handler throw. */
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
      const delaySeconds = computeBackoffSeconds({
        strategy: record.retryBackoff,
        attempt: attemptsMade,
        baseDelaySeconds: record.retryDelaySeconds,
        factor: record.retryBackoffFactor,
        maxDelaySeconds: record.retryMaxDelaySeconds,
        jitter: record.retryJitter,
      });
      const nextRunAt = now + Math.round(secondsToMs(delaySeconds, 'retry delay'));
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
    return { kind: 'failed', error };
  }
}

/**
 * Normalize any thrown value to a message that includes the stack where available, **truncated**.
 *
 * Every failed job stores this in an unbounded text column, and a stack from a deep async chain can
 * run to tens of kilobytes — so a burst of failures used to be able to grow the table faster than
 * the jobs themselves. The cap keeps the throw site and the frames immediately around it (which is
 * the part anyone reads) and says plainly that the rest was dropped.
 */
export function errorToMessage(error: unknown): string {
  return truncate(rawErrorMessage(error));
}

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function truncate(message: string): string {
  if (message.length <= FAILURE_MESSAGE_MAX_CHARS) return message;
  return message.slice(0, FAILURE_MESSAGE_MAX_CHARS) + FAILURE_MESSAGE_TRUNCATION_SUFFIX;
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
