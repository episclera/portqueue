import { parseStatus, requireFlag } from './helpers';

describe('requireFlag', () => {
  it('returns the string value when present', () => {
    expect(requireFlag({ queue: 'emails' }, 'queue')).toBe('emails');
  });

  it('throws an actionable error naming the flag when missing', () => {
    expect(() => requireFlag({}, 'queue')).toThrow('Missing required --queue.');
  });
});

describe('parseStatus', () => {
  it('returns undefined for empty input', () => {
    expect(parseStatus(undefined)).toBeUndefined();
  });

  it('upper-cases and accepts a valid status', () => {
    expect(parseStatus('active')).toBe('ACTIVE');
    expect(parseStatus('FAILED')).toBe('FAILED');
  });

  it('throws with the valid set for an unknown status', () => {
    expect(() => parseStatus('bogus')).toThrow(/Unknown status 'bogus'/);
  });
});
