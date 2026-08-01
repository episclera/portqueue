import { BackoffStrategy } from '../options/enums';
import { DEFAULT_BACKOFF_FACTOR } from '../constants';

export interface BackoffInput {
  strategy: BackoffStrategy;
  /** The attempt number that just failed (1-based). */
  attempt: number;
  /** Base delay in seconds. */
  baseDelaySeconds: number;
  /** Growth factor for EXPONENTIAL (ignored for FIXED). */
  factor?: number | null;
  /** Cap on the computed delay, in seconds. */
  maxDelaySeconds?: number | null;
  /** Whether to apply jitter. */
  jitter?: boolean;
  /** Random source in [0,1) — injectable for deterministic tests. */
  random?: () => number;
}

/**
 * Compute the delay in **seconds** before the next retry. Fractions are preserved — the caller
 * converts to the epoch-ms instant, so rounding here would quantise sub-second retries away.
 * - FIXED: `baseDelaySeconds` each time.
 * - EXPONENTIAL: `baseDelaySeconds * factor^(attempt-1)`, capped at `maxDelaySeconds`.
 * Optional full jitter multiplies the result by a random factor in [0,1].
 */
export function computeBackoffSeconds(input: BackoffInput): number {
  const { strategy, attempt, baseDelaySeconds } = input;
  const factor = input.factor ?? DEFAULT_BACKOFF_FACTOR;
  let delay: number;
  if (strategy === BackoffStrategy.EXPONENTIAL) {
    delay = baseDelaySeconds * Math.pow(factor, Math.max(0, attempt - 1));
  } else {
    delay = baseDelaySeconds;
  }
  if (input.maxDelaySeconds != null) {
    delay = Math.min(delay, input.maxDelaySeconds);
  }
  if (input.jitter) {
    const rand = input.random ?? Math.random;
    // Full jitter: uniform in [0, delay].
    delay = delay * rand();
  }
  return Math.max(0, delay);
}
