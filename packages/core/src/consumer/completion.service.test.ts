/**
 * `errorToMessage` — what a failed row stores. The truncation must land on a code-point boundary (a
 * lone surrogate is invalid text some engines refuse on write), and `FailureDetail` decides whether
 * the frames are kept at all.
 */
import {
  DEFAULT_FAILURE_DETAIL,
  FAILURE_MESSAGE_MAX_CHARS,
  FAILURE_MESSAGE_TRUNCATION_SUFFIX,
} from '../constants';
import { FailureDetail } from '../options/enums';
import { errorToMessage } from './completion.service';

/** True when the string holds a high surrogate with no low surrogate after it. */
function hasLoneHighSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    }
  }
  return false;
}

/** U+1F600, one code point stored as a surrogate pair. */
const PAIR = '\u{1F600}';

describe('errorToMessage', () => {
  it('keeps the stack by default and drops it for FailureDetail.MESSAGE', () => {
    const err = new TypeError('boom');
    expect(DEFAULT_FAILURE_DETAIL).toBe(FailureDetail.STACK);
    expect(errorToMessage(err)).toBe(err.stack);
    expect(errorToMessage(err, FailureDetail.MESSAGE)).toBe('TypeError: boom');
  });

  it('stores a thrown string as-is and serializes anything else', () => {
    expect(errorToMessage('plain')).toBe('plain');
    expect(errorToMessage({ code: 42 })).toBe('{"code":42}');
    expect(errorToMessage(undefined)).toBe('undefined');
  });

  it('leaves a message at the cap untouched', () => {
    const exact = 'x'.repeat(FAILURE_MESSAGE_MAX_CHARS);
    expect(errorToMessage(exact)).toBe(exact);
  });

  it('truncates past the cap and marks the cut', () => {
    const out = errorToMessage('x'.repeat(FAILURE_MESSAGE_MAX_CHARS * 2));
    expect(out).toBe('x'.repeat(FAILURE_MESSAGE_MAX_CHARS) + FAILURE_MESSAGE_TRUNCATION_SUFFIX);
  });

  it('never splits a surrogate pair at the cut', () => {
    // A non-BMP character (two UTF-16 code units) straddling the boundary: its high half is the last unit kept.
    const message = 'x'.repeat(FAILURE_MESSAGE_MAX_CHARS - 1) + PAIR + 'tail';
    const out = errorToMessage(message);
    expect(hasLoneHighSurrogate(out)).toBe(false);
    expect(out).toBe('x'.repeat(FAILURE_MESSAGE_MAX_CHARS - 1) + FAILURE_MESSAGE_TRUNCATION_SUFFIX);
  });

  it('keeps a whole surrogate pair that ends exactly on the cut', () => {
    const message = 'x'.repeat(FAILURE_MESSAGE_MAX_CHARS - 2) + PAIR + 'tail';
    const out = errorToMessage(message);
    expect(out).toBe(
      'x'.repeat(FAILURE_MESSAGE_MAX_CHARS - 2) + PAIR + FAILURE_MESSAGE_TRUNCATION_SUFFIX,
    );
  });
});
