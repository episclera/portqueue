import { InvalidOptionsError } from '../errors/errors';

/**
 * Seconds are the only unit of time PortQueue accepts. Nothing is parsed: a duration option is a
 * plain number of seconds, so `'1m'` (which reads as a month to some and a minute to others) is a
 * type error rather than a silent misconfiguration.
 *
 * Every duration that describes a job — its delay, expiry, retry, retention, recurrence interval,
 * rate window — is a **whole** number of seconds, because that is how it is stored: the duration
 * columns are integers. Fractions are rejected by {@link wholeSeconds} rather than silently
 * truncated by the engine. The in-process loop cadences (tick, poll, lock, heartbeat, sampling,
 * shutdown timeout) are never stored and may be fractional — those go through {@link secondsToMs}.
 *
 * **This module is the only place seconds meet milliseconds.** The clock, `setTimeout`/`setInterval`
 * and every stored *instant* are epoch-ms, so a duration is multiplied by 1000 exactly once, here.
 * There is no inline `* 1000` anywhere else in the codebase.
 */

/** Multiply a validated whole-second duration into milliseconds. */
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

/**
 * Multiply a **possibly fractional** second duration into milliseconds. For the process-local
 * cadences and thresholds that never reach a row — timer intervals, sampling windows, the shutdown
 * budget — where a sub-second value is genuinely meaningful (`0.2` is a useful event-loop-delay
 * threshold; `1` is not). Negative values are allowed here and only here: `extendLock` releases a
 * lock by pushing its deadline into the past.
 */
export function secondsToMs(seconds: number, option: string): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    throw new InvalidOptionsError(
      `Invalid '${option}' value ${JSON.stringify(seconds)}: expected a finite number of ` +
        `seconds. PortQueue takes every duration in seconds — pass 0.2 for 200 ms, not '200ms'.`,
    );
  }
  return seconds * 1000;
}

/**
 * Milliseconds back to seconds, for the one direction that goes the other way: reporting how long
 * something took. Keeps the `/ 1000` beside the `* 1000` rather than inline at the event site.
 */
export function msToSeconds(ms: number): number {
  return ms / 1000;
}
