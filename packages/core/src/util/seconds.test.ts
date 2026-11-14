/**
 * `util/seconds` — the one place seconds meet milliseconds. Pinned because every duration in the
 * API passes through one of these converters, and a regression here (accepting `'1m'`, silently
 * truncating `90.5`) would be invisible at every call site.
 */
import { InvalidOptionsError } from '../errors/errors';
import { MS_PER_SECOND, msToSeconds, secondsToMs, wholeSeconds, wholeSecondsToMs } from './seconds';

describe('seconds converters', () => {
  it('converts whole seconds to milliseconds exactly once', () => {
    expect(MS_PER_SECOND).toBe(1000);
    expect(wholeSecondsToMs(90, 'x')).toBe(90_000);
    expect(wholeSecondsToMs(0, 'x')).toBe(0);
  });

  it('rejects a fraction, a negative, a non-number and a unit string for a stored duration', () => {
    for (const bad of [90.5, -1, NaN, Infinity, '1m' as unknown as number]) {
      expect(() => wholeSeconds(bad, 'expireInSeconds')).toThrow(InvalidOptionsError);
      expect(() => wholeSecondsToMs(bad, 'expireInSeconds')).toThrow(/expireInSeconds/);
    }
  });

  it('accepts fractional and negative seconds for a process-local cadence', () => {
    expect(secondsToMs(0.2, 'x')).toBeCloseTo(200);
    expect(secondsToMs(-1, 'x')).toBe(-1000);
  });

  it('rejects a non-finite or non-number cadence', () => {
    for (const bad of [NaN, Infinity, '200ms' as unknown as number]) {
      expect(() => secondsToMs(bad, 'tickIntervalSeconds')).toThrow(InvalidOptionsError);
    }
  });

  it('reports a millisecond duration back in seconds', () => {
    expect(msToSeconds(1500)).toBe(1.5);
    expect(msToSeconds(secondsToMs(0.25, 'x'))).toBeCloseTo(0.25);
  });
});
