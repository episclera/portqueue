/** @jest-environment node */
import { duration, formatDateTime, totalCount, truncate, utcOffsetLabel } from './format';

/** The suite's own zone label, so the expectations hold wherever it runs. */
const zone = (ms: number): string => utcOffsetLabel(-new Date(ms).getTimezoneOffset());

describe('formatDateTime', () => {
  it('returns a dash for an unparseable instant', () => {
    expect(formatDateTime(Number.NaN)).toBe('—');
  });

  it('renders the one dashboard format, in local time, with the offset named', () => {
    // Built from local parts, so the expectation holds whatever timezone the suite runs in.
    const ms = new Date(2026, 2, 12, 13, 23, 1).getTime();
    expect(formatDateTime(ms)).toBe(`12 Mar. 2026 13:23:01 ${zone(ms)}`);
  });

  it('zero-pads the day and the clock so a column of timestamps lines up', () => {
    const ms = new Date(2026, 0, 3, 4, 5, 6).getTime();
    expect(formatDateTime(ms)).toBe(`03 Jan. 2026 04:05:06 ${zone(ms)}`);
  });

  it('leaves May unabbreviated and keeps the period on the rest', () => {
    const may = new Date(2026, 4, 1, 0, 0, 0).getTime();
    const dec = new Date(2026, 11, 31, 23, 59, 59).getTime();
    expect(formatDateTime(may)).toBe(`01 May 2026 00:00:00 ${zone(may)}`);
    expect(formatDateTime(dec)).toBe(`31 Dec. 2026 23:59:59 ${zone(dec)}`);
  });
});

describe('utcOffsetLabel', () => {
  it('spells Greenwich as plain UTC', () => {
    expect(utcOffsetLabel(0)).toBe('UTC');
  });

  it('names whole-hour offsets either side of Greenwich', () => {
    expect(utcOffsetLabel(120)).toBe('UTC+2');
    expect(utcOffsetLabel(-300)).toBe('UTC-5');
  });

  it('keeps the minutes of an offset that is not a whole hour', () => {
    expect(utcOffsetLabel(330)).toBe('UTC+5:30');
    expect(utcOffsetLabel(-570)).toBe('UTC-9:30');
    expect(utcOffsetLabel(345)).toBe('UTC+5:45');
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
