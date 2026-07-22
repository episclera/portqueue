/**
 * A tiny dependency-free argv parser (build_plan/13.1): subcommands + `--flag value`
 * (and `--bool`). No positional soup. `--` is not needed; the first non-flag token is the
 * (sub)command path.
 */
export interface ParsedArgs {
  command: string[];
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let seenFlag = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token.startsWith('--')) {
      seenFlag = true;
      const eq = token.indexOf('=');
      if (eq !== -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else if (!seenFlag) {
      command.push(token);
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
