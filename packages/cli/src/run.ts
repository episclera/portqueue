import type { PortQueue } from '@portqueue/core';
import { flagBool, flagString, parseArgs } from './args.js';
import { COMMANDS_BY_NAME } from './commands/index.js';
import { loadPortQueue } from './config-loader.js';
import { CliError } from './errors.js';
import { renderHelp } from './help.js';
import { fail, setColorEnabled } from './output.js';

/** A `--watch` flag turns an otherwise one-shot command into a long-running one. */
const WATCH_FLAG = 'watch';

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const commandName = parsed.command[0];

  if (!commandName || commandName === 'help' || flagBool(parsed.flags, 'help')) {
    process.stdout.write(renderHelp());
    return 0;
  }
  if (flagBool(parsed.flags, 'no-color')) setColorEnabled(false);

  const command = COMMANDS_BY_NAME.get(commandName);
  if (!command) {
    fail(`Unknown command '${commandName}'. Run \`portqueue help\`.`);
    return 1;
  }

  let pq: PortQueue | undefined;
  try {
    const loaded = await loadPortQueue({
      ...(flagString(parsed.flags, 'config')
        ? { configPath: flagString(parsed.flags, 'config')! }
        : {}),
      ...(flagString(parsed.flags, 'export')
        ? { exportName: flagString(parsed.flags, 'export')! }
        : {}),
    });
    pq = loaded.pq;
    if (!pq.isRunning) await pq.init();
    await command.run({ pq, flags: parsed.flags });
    // Long-running commands (stream/serve, or --watch) keep the client alive.
    const persistent = command.persistent === true || flagBool(parsed.flags, WATCH_FLAG);
    if (!persistent) await pq.shutdown();
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      fail(err.message);
    } else {
      const debug = flagString(parsed.flags, 'log-level') === 'debug';
      fail(`${(err as Error).message}${debug ? `\n${(err as Error).stack}` : ''}`);
    }
    if (pq) await pq.shutdown().catch(() => undefined);
    return 1;
  }
}
