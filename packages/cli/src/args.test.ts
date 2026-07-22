import { flagBool, flagNumber, flagString, parseArgs } from './args.js';

describe('parseArgs', () => {
  it('collects the leading tokens as the command path', () => {
    const parsed = parseArgs(['jobs']);
    expect(parsed.command).toEqual(['jobs']);
    expect(parsed.flags).toEqual({});
    expect(parsed.positionals).toEqual([]);
  });

  it('parses `--flag value` pairs', () => {
    const parsed = parseArgs(['jobs', '--queue', 'emails', '--limit', '10']);
    expect(parsed.command).toEqual(['jobs']);
    expect(parsed.flags).toEqual({ queue: 'emails', limit: '10' });
  });

  it('parses `--flag=value` form', () => {
    const parsed = parseArgs(['add', '--data={"a":1}']);
    expect(parsed.flags).toEqual({ data: '{"a":1}' });
  });

  it('treats a flag with no value as a boolean true', () => {
    const parsed = parseArgs(['stats', '--watch', '--json']);
    expect(parsed.flags).toEqual({ watch: true, json: true });
  });

  it('routes non-flag tokens after the first flag into positionals', () => {
    const parsed = parseArgs(['cmd', '--flag', 'val', 'extra']);
    expect(parsed.command).toEqual(['cmd']);
    expect(parsed.flags).toEqual({ flag: 'val' });
    expect(parsed.positionals).toEqual(['extra']);
  });

  it('returns empty structures for no argv', () => {
    expect(parseArgs([])).toEqual({ command: [], flags: {}, positionals: [] });
  });
});

describe('flag accessors', () => {
  const flags = { queue: 'emails', limit: '10', watch: true, bad: 'nope', truthy: 'true' };

  it('flagString returns strings only', () => {
    expect(flagString(flags, 'queue')).toBe('emails');
    expect(flagString(flags, 'watch')).toBeUndefined(); // boolean, not a string
    expect(flagString(flags, 'missing')).toBeUndefined();
  });

  it('flagNumber coerces numeric strings', () => {
    expect(flagNumber(flags, 'limit')).toBe(10);
    expect(flagNumber(flags, 'missing')).toBeUndefined();
    expect(Number.isNaN(flagNumber(flags, 'bad') as number)).toBe(true);
  });

  it('flagBool is true for boolean-true and the string "true"', () => {
    expect(flagBool(flags, 'watch')).toBe(true);
    expect(flagBool(flags, 'truthy')).toBe(true);
    expect(flagBool(flags, 'queue')).toBe(false);
    expect(flagBool(flags, 'missing')).toBe(false);
  });
});
