import {
  color,
  colorStatus,
  fail,
  heading,
  printJson,
  relativeTime,
  setColorEnabled,
  success,
  table,
  warn,
} from './output';
import { captureOutput } from './test-support/capture';

beforeEach(() => setColorEnabled(false));

describe('color', () => {
  it('returns the raw text when color is disabled', () => {
    expect(color('hi', 'red')).toBe('hi');
  });

  it('wraps text in ANSI codes when enabled', () => {
    setColorEnabled(true);
    const out = color('hi', 'red');
    expect(out).toContain('hi');
    expect(out).toContain('\x1b[');
    expect(out.endsWith('\x1b[0m')).toBe(true);
  });
});

describe('colorStatus', () => {
  it('passes the status text through (color disabled)', () => {
    expect(colorStatus('ACTIVE')).toBe('ACTIVE');
    expect(colorStatus('COMPLETED')).toBe('COMPLETED');
    expect(colorStatus('UNKNOWN')).toBe('UNKNOWN');
  });
});

describe('writers', () => {
  it('success and heading write to stdout', async () => {
    const { stdout, stderr } = await captureOutput(() => {
      success('done');
      heading('Title');
    });
    expect(stdout).toContain('done');
    expect(stdout).toContain('Title');
    expect(stderr).toBe('');
  });

  it('warn writes to stdout, fail writes to stderr', async () => {
    const { stdout, stderr } = await captureOutput(() => {
      warn('careful');
      fail('boom');
    });
    expect(stdout).toContain('careful');
    expect(stderr).toContain('boom');
  });

  it('printJson pretty-prints', async () => {
    const { stdout } = await captureOutput(() => printJson({ a: 1 }));
    expect(stdout).toBe('{\n  "a": 1\n}\n');
  });
});

describe('table', () => {
  it('aligns columns and prints a header + rows', async () => {
    const { stdout } = await captureOutput(() =>
      table(
        ['Name', 'Count'],
        [
          ['emails', '2'],
          ['sms', '10'],
        ],
      ),
    );
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toContain('Name');
    expect(lines[0]).toContain('Count');
    expect(lines[1]).toContain('emails');
    expect(lines[2]).toContain('sms');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-07-22T12:00:00.000Z').getTime();

  it('renders a dash for empty input', () => {
    expect(relativeTime(null, now)).toBe('—');
    expect(relativeTime(undefined, now)).toBe('—');
  });

  it('renders future times with "in"', () => {
    expect(relativeTime(new Date(now + 30_000), now)).toBe('in 30s');
    expect(relativeTime(new Date(now + 2 * 60_000), now)).toBe('in 2m');
  });

  it('renders past times with "ago"', () => {
    expect(relativeTime(new Date(now - 45_000), now)).toBe('45s ago');
    expect(relativeTime(new Date(now - 3 * 3600_000), now)).toBe('3h ago');
    expect(relativeTime(new Date(now - 2 * 86_400_000), now)).toBe('2d ago');
  });
});
