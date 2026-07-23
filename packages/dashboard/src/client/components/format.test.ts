/** @jest-environment node */
import { duration, formatDate, relativeTime, totalCount, truncate } from './format';

describe('formatDate', () => {
  it('returns a dash for empty or invalid input', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });

  it('formats a valid ISO string', () => {
    expect(formatDate('2026-07-22T00:00:00.000Z')).not.toBe('—');
  });
});

describe('relativeTime', () => {
  it('returns a dash for empty/invalid input', () => {
    expect(relativeTime(null)).toBe('—');
    expect(relativeTime('nope')).toBe('—');
  });

  it('produces a relative phrase for a valid time', () => {
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(relativeTime(soon)).toMatch(/minute/);
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
