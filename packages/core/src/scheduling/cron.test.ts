import { CronExpression } from './cron';
import { InvalidOptionsError } from '../errors/errors';

// A fixed reference instant: 2026-01-01T00:00:00Z (a Thursday).
const REF = Date.UTC(2026, 0, 1, 0, 0, 0);

describe('CronExpression', () => {
  it('computes the next minute for "* * * * *"', () => {
    const cron = new CronExpression('* * * * *', 'UTC');
    expect(cron.next(REF)).toBe(REF + 60_000);
  });

  it('computes a daily midnight run', () => {
    const cron = new CronExpression('0 0 * * *', 'UTC');
    expect(cron.next(REF)).toBe(Date.UTC(2026, 0, 2, 0, 0, 0));
  });

  it('handles step values (every 15 minutes)', () => {
    const cron = new CronExpression('*/15 * * * *', 'UTC');
    expect(cron.next(REF + 1000)).toBe(Date.UTC(2026, 0, 1, 0, 15, 0));
  });

  it('handles ranges and lists', () => {
    const cron = new CronExpression('0 9-17 * * 1-5', 'UTC');
    // 2026-01-01 is a Thursday (weekday 4) → 09:00 same day.
    expect(cron.next(REF)).toBe(Date.UTC(2026, 0, 1, 9, 0, 0));
  });

  it('handles a comma-separated list of hours', () => {
    const cron = new CronExpression('0 6,18 * * *', 'UTC');
    expect(cron.next(REF)).toBe(Date.UTC(2026, 0, 1, 6, 0, 0));
    expect(cron.next(Date.UTC(2026, 0, 1, 6, 0, 0))).toBe(Date.UTC(2026, 0, 1, 18, 0, 0));
  });

  it('supports a 6-field expression with seconds', () => {
    const cron = new CronExpression('30 * * * * *', 'UTC');
    expect(cron.next(REF)).toBe(REF + 30_000);
  });

  it('supports month and weekday names', () => {
    const cron = new CronExpression('0 0 * * MON', 'UTC');
    // The first Monday after Thursday 2026-01-01 is 2026-01-05.
    expect(cron.next(REF)).toBe(Date.UTC(2026, 0, 5, 0, 0, 0));
  });

  it('supports the `L` specials the hand-rolled parser used to reject', () => {
    const cron = new CronExpression('0 0 L * *', 'UTC');
    expect(cron.next(REF)).toBe(Date.UTC(2026, 0, 31, 0, 0, 0));
  });

  it('respects timezones (DST-safe wall clock)', () => {
    const cron = new CronExpression('0 12 * * *', 'America/New_York');
    // Next noon in New York (EST, UTC-5 in January) = 17:00 UTC.
    expect(cron.next(REF)).toBe(Date.UTC(2026, 0, 1, 17, 0, 0));
  });

  it('crosses a DST boundary without drifting off the wall-clock hour', () => {
    const cron = new CronExpression('0 12 * * *', 'America/New_York');
    // 2026-03-08 is the US spring-forward day; noon local is 16:00 UTC from then on (EDT).
    const beforeDst = Date.UTC(2026, 2, 7, 17, 0, 0); // noon EST on the 7th
    expect(cron.next(beforeDst)).toBe(Date.UTC(2026, 2, 8, 16, 0, 0));
  });

  it('rejects a malformed expression', () => {
    expect(() => new CronExpression('0 0 * *')).toThrow(InvalidOptionsError);
    expect(() => new CronExpression('99 0 * * *')).toThrow(InvalidOptionsError);
    expect(() => new CronExpression('not a cron')).toThrow(InvalidOptionsError);
  });

  it('rejects an unknown timezone', () => {
    expect(() => new CronExpression('* * * * *', 'Mars/Olympus')).toThrow(InvalidOptionsError);
  });
});
