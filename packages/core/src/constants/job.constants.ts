/** Per-job resolution defaults — what a job gets when neither it nor its queue says otherwise. */

/** Higher runs first. `JobOptions.priority`. */
export const DEFAULT_PRIORITY = 0;

/** Attempts including the first, so the default is "run once, never retry". `retry.maxAttempts`. */
export const DEFAULT_RETRY_MAX_ATTEMPTS = 1;

/** Delay before a retry, **in seconds**. `retry.delaySeconds`. */
export const DEFAULT_RETRY_DELAY_SECONDS = 0;

/** Growth factor an EXPONENTIAL backoff uses when none is given. `retry.backoff.factor`. */
export const DEFAULT_BACKOFF_FACTOR = 2;

/**
 * How much of a failure's stack is kept in `failure_message`. A stack is unbounded and every
 * failed row stores one, so it is truncated to a size that still shows the throw site and the
 * frames around it.
 */
export const FAILURE_MESSAGE_MAX_CHARS = 4000;

/** Marker appended to a truncated failure message so a reader knows frames were dropped. */
export const FAILURE_MESSAGE_TRUNCATION_SUFFIX = '… [truncated]';
