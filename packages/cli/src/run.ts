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
  let closing: Promise<void> | undefined;

  /** Run one teardown, tolerating its failure so the rest still run. */
  const release = (teardown: Teardown): Promise<void> =>
    Promise.resolve()
      .then(teardown)
      .catch(() => undefined);

  // A resource opened after the shutdown began (a command still starting up when Ctrl-C landed) is
  // released straight away rather than queued behind a drain that has already read the list.
  const onExit = (fn: Teardown): void => {
    if (closing) void release(fn);
    else teardowns.unshift(fn);
  };

  /**
   * Release everything this run opened, exactly once. Memoized rather than flagged: a second caller
   * — the catch below after a signal made the command throw — waits for the same drain instead of
   * returning at once and letting the process exit underneath it.
   */
  const closeAll = (): Promise<void> =>
    (closing ??= (async () => {
      for (const teardown of teardowns.splice(0)) await release(teardown);
      if (pq) await pq.shutdown().catch(() => undefined);
    })());

  let uninstallStopHandlers: (() => void) | undefined;
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
    if (persistent) uninstallStopHandlers = installStopHandlers(closeAll);
    await command.run({ pq, flags: parsed.flags, onExit });
    // A persistent command never returns — it is held open until a signal, whose handler owns the
    // shutdown. So a command that *did* return is finished, whatever its flags said: `jobs --watch`
    // (a command with nothing to watch) used to skip this and exit with the client still connected.
    await closeAll();
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
  } finally {
    uninstallStopHandlers?.();
  }
}

/**
 * Close down on the first stop signal, then exit.
 *
 * `once` per signal, so a second Ctrl-C is not queued behind an in-flight drain — it reaches Node's
 * default handler and kills the process, which is what a user pressing it twice is asking for.
 */
function installStopHandlers(closeAll: () => Promise<void>): () => void {
  const handlers = STOP_SIGNALS.map((signal) => {
    const handler = (): void => {
      void closeAll().then(() => {
        process.exit(signal === 'SIGINT' ? EXIT_ON_SIGINT : EXIT_ON_SIGTERM);
      });
    };
    process.once(signal, handler);
    return { signal, handler };
  });
  // Removed once the run is over, so a finished command leaves no listener behind to fire later.
  return () => {
    for (const { signal, handler } of handlers) process.removeListener(signal, handler);
  };
}
