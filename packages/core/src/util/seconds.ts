import { InvalidOptionsError } from '../errors/errors';

/**
 * Seconds are the only unit of time PortQueue accepts. Nothing is parsed: a duration option is a
 * plain number of seconds, so `'1m'` (which reads as a month to some and a minute to others) is a
 * type error rather than a silent misconfiguration.
 *
 * Every duration that describes a job — its delay, expiry, retry, retention, recurrence interval,
 * rate window — is a **whole** number of seconds, because that is how it is stored: the duration
 * columns are integers. Fractions are rejected here rather than silently truncated by the engine.
 * (The in-process loop cadences — tick, poll, lock, heartbeat, sampling, shutdown timeout — are
 * never stored and multiply inline, so they may be fractional.)
 *
 * This is also the one place a configured duration meets the millisecond epoch the clock and the
 * `setTimeout`/`setInterval` family speak in, so a duration is multiplied by 1000 exactly once.
 */
export function wholeSecondsToMs(seconds: number, option: string): number {
  return wholeSeconds(seconds, option) * 1000;
}

/** Validate a whole-second duration and return it unchanged. */
export function wholeSeconds(seconds: number, option: string): number {
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 0) {
    throw new InvalidOptionsError(
      `Invalid '${option}' value ${JSON.stringify(seconds)}: expected a whole, non-negative ` +
        `number of seconds. PortQueue takes every duration in seconds and stores them as ` +
        `integers — pass 90, not '1m30s' and not 90.5.`,
    );
  }
  return seconds;
}
