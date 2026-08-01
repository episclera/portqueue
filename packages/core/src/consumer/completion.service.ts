import { JobStatus } from '../jobs/job-state.enum';
import { PortQueueEvent } from '../events/event-name.enum';
import { computeBackoffSeconds } from '../util/backoff';
import { msToSeconds, secondsToMs } from '../util/seconds';
import { LockLostError } from '../errors/errors';
import {
  DEFAULT_FAILURE_DETAIL,
  FAILURE_MESSAGE_MAX_CHARS,
  FAILURE_MESSAGE_TRUNCATION_SUFFIX,
} from '../constants';
import { FailureDetail } from '../options/enums';
import type { ErrorClass } from '../options/queue-options';
import type { JobRecord } from '../jobs/job-record';
import type { Runtime } from '../client/runtime';
import type { ProcessOutcome } from '../events/hooks';

/**
 * Marks complete/failed/retry atomically and emits the matching event.
 *
 * Every write is fenced on the claim the run was made under (`record.lockToken`), and the driver
 * reports whether the row was actually settled. When it was not — the lock lapsed, another worker
 * reclaimed the row and is running the job now — this run's outcome is **not** the job's outcome, so
 * no lifecycle event is emitted for it and the `ERROR` event carries a {@link LockLostError}
 * instead. Emitting `JOB_COMPLETED` there would tell every listener a job had finished while its
 * second run was still going.
 */
export class CompletionService {
  constructor(private readonly runtime: Runtime) {}

  async complete(
    record: JobRecord,
    queueName: string,
    returnValue: unknown,
    startTs: number,
  ): Promise<ProcessOutcome> {
    const now = this.runtime.clock.now();
    const settled = await this.runtime.driver.completeJob({
      jobId: record.id,
      returnValue,
      now,
      lockToken: record.lockToken,
    });
    if (!settled) return this.claimLost(record, queueName, { kind: 'completed', returnValue });
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
    failureDetail: FailureDetail = DEFAULT_FAILURE_DETAIL,
  ): Promise<ProcessOutcome> {
    const now = this.runtime.clock.now();
    const message = errorToMessage(error, failureDetail);
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
      const outcome: ProcessOutcome = { kind: 'retry', error, nextRunAt: new Date(nextRunAt) };
      const armed = await this.runtime.driver.retryJob({
        jobId: record.id,
        nextRunAt,
        retryAttempt: attemptsMade,
        lastError: message,
        now,
        lockToken: record.lockToken,
      });
      if (!armed) return this.claimLost(record, queueName, outcome);
      this.runtime.events.emit(PortQueueEvent.JOB_RETRYING, {
        jobId: record.id,
        queue: queueName,
        retryAttempt: attemptsMade,
        nextRunAt: new Date(nextRunAt),
      });
      // Wake the loop; the claim query still gates on start_after so a delayed retry waits.
      this.runtime.wakeup.signal(queueName);
      return outcome;
    }

    const failed = await this.runtime.driver.failJob({
      jobId: record.id,
      lastError: message,
      now,
      lockToken: record.lockToken,
    });
    if (!failed) return this.claimLost(record, queueName, { kind: 'failed', error });
    this.runtime.events.emit(PortQueueEvent.JOB_FAILED, {
      jobId: record.id,
      queue: queueName,
      error,
      retryAttempt: record.retryAttempt,
    });
    return { kind: 'failed', error };
  }

  /**
   * Report a settle the row refused, and hand back the outcome unchanged.
   *
   * The outcome still describes what *this handler* did, which is what an `AFTER_PROCESS` hook is
   * asking about; what it no longer describes is the row, so nothing is emitted for the job.
   */
  private claimLost(record: JobRecord, queueName: string, outcome: ProcessOutcome): ProcessOutcome {
    this.runtime.events.emit(PortQueueEvent.ERROR, {
      error: new LockLostError(record.id, queueName),
      source: 'completion',
    });
    return outcome;
  }
}

/**
 * Normalize any thrown value to the message stored on the row, **truncated**.
 *
 * Includes the stack by default, because that is what anyone diagnosing a failure opens the job to
 * read. A stack from a deep async chain runs to tens of kilobytes, so it is capped — and a queue that
 * fails often and predictably can drop the frames altogether with
 * `createQueue({ failureDetail: FailureDetail.MESSAGE })`, since even the capped form is ~4 KB on
 * every failed row.
 */
export function errorToMessage(
  error: unknown,
  detail: FailureDetail = DEFAULT_FAILURE_DETAIL,
): string {
  return truncate(rawErrorMessage(error, detail));
}

function rawErrorMessage(error: unknown, detail: FailureDetail): string {
  if (error instanceof Error) {
    const named = `${error.name}: ${error.message}`;
    // `MESSAGE` is the choice a queue makes when its handler fails often: the frames are noise, and
    // ~4 KB per failed row is not.
    if (detail === FailureDetail.MESSAGE) return named;
    return error.stack ?? named;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/**
 * Cut a message to the cap **on a code-point boundary**.
 *
 * `slice` counts UTF-16 code units, so cutting mid-surrogate-pair stores a lone surrogate — which is
 * not valid text, and which some engines (Oracle in particular) refuse on write. An emoji or a
 * non-BMP character landing exactly on the boundary is enough to hit it. Dropping the trailing high
 * surrogate keeps the message one character shorter and always writable.
 */
function truncate(message: string): string {
  if (message.length <= FAILURE_MESSAGE_MAX_CHARS) return message;
  let end = FAILURE_MESSAGE_MAX_CHARS;
  const last = message.charCodeAt(end - 1);
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  if (isHighSurrogate) end -= 1;
  return message.slice(0, end) + FAILURE_MESSAGE_TRUNCATION_SUFFIX;
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
