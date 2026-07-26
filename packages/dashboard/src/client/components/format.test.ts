/** @jest-environment node */
import { absoluteTime, duration, relativeTime, totalCount, truncate } from './format';

/** A fixed instant, so the absolute formatter has something stable to render. */
const FIXED = Date.parse('2026-07-22T00:00:00.000Z');

describe('absoluteTime', () => {
  it('returns a dash for an unparseable instant', () => {
    expect(absoluteTime(Number.NaN)).toBe('—');
  });

  it('formats a valid instant and names the timezone', () => {
    const out = absoluteTime(FIXED);
    expect(out).not.toBe('—');
    // The zone marker is what stops a shared screenshot being ambiguous across regions.
    expect(out).toMatch(/\d/);
    expect(out.length).toBeGreaterThan(10);
  });
});

describe('relativeTime', () => {
  it('returns a dash for an unparseable instant', () => {
    expect(relativeTime(Number.NaN)).toBe('—');
  });

  it('produces a relative phrase in both directions', () => {
    expect(relativeTime(Date.now() + 5 * 60_000)).toMatch(/minute/);
    expect(relativeTime(Date.now() - 3 * 3_600_000)).toMatch(/hour/);
  });
});

describe('duration', () => {
  it('returns a dash when an endpoint is missing or negative', () => {
    expect(duration(null, '2026-07-22T00:00:00.000Z')).toBe('—');
    expect(duration('2026-07-22T00:00:02.000Z', '2026-07-22T00:00:00.000Z')).toBe('—');
  });

  it('formats sub-second, seconds, and minutes', () => {
    expect(duration('2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.500Z')).toBe('500ms');
    expect(duration('2026-07-22T00:00:00.000Z', '2026-07-22T00:00:02.000Z')).toBe('2.0s');
    expect(duration('2026-07-22T00:00:00.000Z', '2026-07-22T00:02:30.000Z')).toBe('2m 30s');
  });
});

describe('truncate', () => {
  it('returns a dash for empty input', () => {
    expect(truncate(null)).toBe('—');
  });

  it('leaves short ids intact and shortens long ones', () => {
    expect(truncate('short')).toBe('short');
    expect(truncate('0123456789abcdefghij')).toBe('01234567…efghij');
  });
});

describe('totalCount', () => {
  it('sums all count values', () => {
    expect(totalCount({ PENDING: 2, ACTIVE: 3, FAILED: 0 })).toBe(5);
    expect(totalCount({})).toBe(0);
  });
});
