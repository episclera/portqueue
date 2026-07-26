import { InvalidOptionsError } from '../errors/errors';

/**
 * Seconds are the only duration unit PortQueue accepts. Nothing is parsed: a duration option is a
 * plain number of seconds, so `'1m'` (which reads as a month to some and a minute to others) is a
 * type error rather than a silent misconfiguration.
 *
 * This is the one place a configured duration meets the millisecond epoch the clock and the
 * `setTimeout`/`setInterval` family speak in. It validates strictly so a bad value fails at the
 * call that set it, naming the option.
 */
export function secondsToMs(seconds: number, option: string): number {
  return assertSeconds(seconds, option) * 1000;
}

/** Validate a seconds value and return it unchanged. Fractions are allowed; negatives are not. */
export function assertSeconds(seconds: number, option: string): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    throw new InvalidOptionsError(
      `Invalid '${option}' value ${JSON.stringify(seconds)}: expected a non-negative, finite ` +
        `number of seconds (PortQueue takes every duration in seconds — pass 90, not '1m30s').`,
    );
  }
  return seconds;
}
