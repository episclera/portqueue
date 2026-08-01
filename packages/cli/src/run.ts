/**
 * Command dispatch: parse argv, build the client, run one command, and shut everything down exactly
 * once.
 *
 * The shutdown story is the part worth reading. A one-shot command shuts down when it returns. A
 * **persistent** one (`listen`, `dashboard`, or any command with `--watch`) stays alive until the
 * process is interrupted, so it registers a signal handler that closes whatever it opened, then the
 * client, then exits. Two bugs this replaces: a persistent command that threw *after* binding a port
 * left the server listening while the client disconnected — `portqueue dashboard` then served 503s
 * from a mount whose driver was gone instead of exiting — and Ctrl-C dropped in-flight background
 * work and the connection rather than draining them.
 */
import type { PortQueue } from '@portqueue/core';
import { flagBool, flagString, parseArgs } from './args';
import { COMMANDS_BY_NAME } from './commands/index';
import { buildPortQueue } from './driver';
import { CliError } from './errors';
import { renderHelp } from './help';
import { fail, setColorEnabled } from './output';
import type { Teardown } from './commands/types';

/** A `--watch` flag turns an otherwise one-shot command into a long-running one. */
const WATCH_FLAG = 'watch';

/** How a terminal and a container each ask a process to stop. */
const STOP_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/** Conventional exit codes for "killed by signal N" (128 + N). */
const EXIT_ON_SIGINT = 130;
const EXIT_ON_SIGTERM = 143;

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
  // Whatever the command opened — a server, an interval, a dashboard mount — newest first, so a
  // resource is released before the thing it depends on.
  const teardowns: Teardown[] = [];
  const onExit = (fn: Teardown): void => void teardowns.unshift(fn);

  /** Release everything this run opened, once, tolerating a failure in any single step. */
  const closeAll = async (): Promise<void> => {
    const client = pq;
    pq = undefined; // claim the shutdown, so a signal and the catch below can't both run it
    for (const teardown of teardowns.splice(0)) {
      await Promise.resolve()
        .then(teardown)
        .catch(() => undefined);
    }
    if (client) await client.shutdown().catch(() => undefined);
  };

  try {
    pq = await buildPortQueue({
      driver: flagString(parsed.flags, 'driver'),
      connectionString: flagString(parsed.flags, 'connection-string'),
      schema: flagString(parsed.flags, 'schema'),
      tablePrefix: flagString(parsed.flags, 'table-prefix'),
      namespace: flagString(parsed.flags, 'namespace'),
    });
    if (!pq.isRunning) await pq.init();
    const persistent = command.persistent === true || flagBool(parsed.flags, WATCH_FLAG);
    // Installed before the command runs, so an interrupt during its startup is handled too.
    if (persistent) installStopHandlers(closeAll);
    await command.run({ pq, flags: parsed.flags, onExit });
    // A persistent command keeps the client alive; its signal handler owns the shutdown.
    if (!persistent) await closeAll();
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      fail(err.message);
    } else {
      const debug = flagString(parsed.flags, 'log-level') === 'debug';
      fail(`${(err as Error).message}${debug ? `\n${(err as Error).stack}` : ''}`);
    }
    await closeAll();
    return 1;
  }
}

/**
 * Close down on the first stop signal, then exit.
 *
 * `once` per signal, so a second Ctrl-C is not queued behind an in-flight drain — it reaches Node's
 * default handler and kills the process, which is what a user pressing it twice is asking for.
 */
function installStopHandlers(closeAll: () => Promise<void>): void {
  for (const signal of STOP_SIGNALS) {
    process.once(signal, () => {
      void closeAll().then(() => {
        process.exit(signal === 'SIGINT' ? EXIT_ON_SIGINT : EXIT_ON_SIGTERM);
      });
    });
  }
}
