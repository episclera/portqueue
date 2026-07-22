import { BackoffStrategy } from '../options/enums.js';

export interface BackoffInput {
  strategy: BackoffStrategy;
  /** The attempt number that just failed (1-based). */
  attempt: number;
  /** Base delay in ms. */
  baseDelayMs: number;
  /** Growth factor for EXPONENTIAL (ignored for FIXED). */
  factor?: number | null;
  /** Cap on the computed delay in ms. */
  maxDelayMs?: number | null;
  /** Whether to apply jitter. */
  jitter?: boolean;
  /** Random source in [0,1) — injectable for deterministic tests. */
  random?: () => number;
}

/**
 * Compute the delay (ms) before the next retry.
 * - FIXED: `baseDelayMs` each time.
 * - EXPONENTIAL: `baseDelayMs * factor^(attempt-1)`, capped at `maxDelayMs`.
 * Optional full jitter multiplies the result by a random factor in [0,1].
 */
export function computeBackoffMs(input: BackoffInput): number {
  const { strategy, attempt, baseDelayMs } = input;
  const factor = input.factor ?? 2;
  let delay: number;
  if (strategy === BackoffStrategy.EXPONENTIAL) {
    delay = baseDelayMs * Math.pow(factor, Math.max(0, attempt - 1));
  } else {
    delay = baseDelayMs;
  }
  if (input.maxDelayMs != null) {
    delay = Math.min(delay, input.maxDelayMs);
  }
  if (input.jitter) {
    const rand = input.random ?? Math.random;
    // Full jitter: uniform in [0, delay].
    delay = delay * rand();
  }
  return Math.max(0, Math.round(delay));
}
