import { COMMANDS } from './commands/index';
import { CommandGroup } from './commands/types';

const INTRO = `
portqueue — operate and monitor a PortQueue instance.

Usage: portqueue <command> [--flags]
`;

const GLOBAL_FLAGS = `
Global flags:
  --driver <engine>          postgres | pglite | sqlite | mysql | oracle
  --connection-string <s>    DB connection string (also via DATABASE_URL)
  --schema <name>            Optional storage schema
  --table-prefix <name>      Optional table prefix (default pq_)
  --namespace <name>         Optional pub/sub namespace
  --json                     Machine-readable output
  --no-color                 Disable ANSI color
`;

/** Build the help text from the command registry so it can never drift from reality. */
export function renderHelp(): string {
  const sections = Object.values(CommandGroup)
    .map((group) => {
      const commands = COMMANDS.filter((command) => command.group === group);
      if (commands.length === 0) return '';
      const lines = commands.map((command) => {
        const signature = command.usage ? `${command.name} ${command.usage}` : command.name;
        return `  ${signature}\n      ${command.summary}`;
      });
      return `${group}:\n${lines.join('\n')}`;
    })
    .filter(Boolean);

  return `${INTRO}\n${sections.join('\n\n')}\n${GLOBAL_FLAGS}`;
}
