/**
 * A tiny dependency-free argv parser: subcommands + `--flag value`
 * (and `--bool`). No positional soup. `--` is not needed; the first non-flag token is the
 * (sub)command path.
 *
 * One rule earns its own list below: a **boolean flag never consumes the token after it**. Without
 * that, `portqueue --json jobs` parsed as `{ json: 'jobs' }` with no command at all and printed
 * help — and `help.ts` advertises `--json`/`--no-color` as global, which invites exactly that
 * ordering.
 */
export interface ParsedArgs {
  command: string[];
  flags: Record<string, string | boolean>;
  positionals: string[];
}

/**
 * Every flag that is a switch rather than a setting. Kept as one list because the alternative —
 * inferring from what follows — cannot tell `--json jobs` (a flag and a command) from
 * `--queue jobs` (a flag and its value).
 */
export const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'json',
  'watch',
  'yes',
  'no-color',
  'help',
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let sawCommand = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        // `--json=false` is still honoured above; a bare boolean flag is true and leaves the next
        // token alone, so the command that follows it is still the command.
        if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else if (!sawCommand) {
      // The first bare token (a flag's consumed value never reaches here) is the command,
      // even when global connection or boolean flags precede it.
      command.push(token);
      sawCommand = true;
    } else {
      positionals.push(token);
    }
  }
  return { command, flags, positionals };
}

export function flagString(
  flags: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const v = flags[name];
  return typeof v === 'string' ? v : undefined;
}

export function flagNumber(
  flags: Record<string, string | boolean>,
  name: string,
): number | undefined {
  const v = flagString(flags, name);
  return v === undefined ? undefined : Number(v);
}

export function flagBool(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true || flags[name] === 'true';
}
