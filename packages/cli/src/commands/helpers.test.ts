import { pageFlags, parseStatus, printMoreHint, requireFlag } from './helpers';
import { setColorEnabled } from '../output';
import { captureOutput } from '../test-support/capture';

beforeEach(() => setColorEnabled(false));

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

describe('pageFlags', () => {
  it('passes an offset of 0 through rather than reading it as unset', () => {
    // Truthiness used to drop a `0`; the window must say exactly what was asked for.
    expect(pageFlags({ offset: '0' })).toEqual({ offset: 0 });
    expect(pageFlags({ limit: '10', offset: '20' })).toEqual({ limit: 10, offset: 20 });
  });

  it('leaves both unset when neither flag is given', () => {
    expect(pageFlags({})).toEqual({});
  });

  it('rejects a limit of 0 instead of silently paging the default', () => {
    expect(() => pageFlags({ limit: '0' })).toThrow(/--limit must be a whole number of at least 1/);
  });

  it('rejects a negative, fractional or non-numeric window', () => {
    expect(() => pageFlags({ limit: '-5' })).toThrow(/--limit/);
    expect(() => pageFlags({ limit: '2.5' })).toThrow(/--limit/);
    expect(() => pageFlags({ limit: 'ten' })).toThrow(/--limit/);
    expect(() => pageFlags({ offset: '-1' })).toThrow(/--offset/);
  });

  it('rejects a bare flag with no value rather than treating it as unset', () => {
    // `--limit --offset 5` parses `limit` as a switch; reading that as "no limit" is the same bug.
    expect(() => pageFlags({ limit: true, offset: '5' })).toThrow('--limit needs a value.');
    expect(() => pageFlags({ offset: true })).toThrow('--offset needs a value.');
  });
});

describe('printMoreHint', () => {
  it('names the next offset when the page stops short of the total', async () => {
    const { stdout } = await captureOutput(() => printMoreHint({ items: [1, 2], total: 5 }, 2));
    expect(stdout).toContain('use --offset 4');
  });

  it('says nothing on the last page', async () => {
    const { stdout } = await captureOutput(() => printMoreHint({ items: [1, 2], total: 4 }, 2));
    expect(stdout).toBe('');
  });

  it('counts from 0 when no offset was given', async () => {
    const { stdout } = await captureOutput(() => printMoreHint({ items: [1], total: 3 }));
    expect(stdout).toContain('use --offset 1');
  });
});
