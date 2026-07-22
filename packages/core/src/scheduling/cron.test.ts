import { CronExpression } from './cron.js';
import { InvalidOptionsError } from '../errors/errors.js';

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

  it('supports a 6-field expression with seconds', () => {
    const cron = new CronExpression('30 * * * * *', 'UTC');
    expect(cron.next(REF)).toBe(REF + 30_000);
  });

  it('respects timezones (DST-safe wall clock)', () => {
    const cron = new CronExpression('0 12 * * *', 'America/New_York');
    // Next noon in New York (EST, UTC-5 in January) = 17:00 UTC.
    expect(cron.next(REF)).toBe(Date.UTC(2026, 0, 1, 17, 0, 0));
  });

  it('rejects unsupported tokens and bad fields', () => {
    expect(() => new CronExpression('0 0 L * *')).toThrow(InvalidOptionsError);
    expect(() => new CronExpression('0 0 * *')).toThrow(InvalidOptionsError);
    expect(() => new CronExpression('99 0 * * *')).toThrow(InvalidOptionsError);
  });
});
