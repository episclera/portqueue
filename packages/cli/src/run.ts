import { parseArgs, flagBool, flagString } from './args.js';
import { loadPortQueue, CliError } from './config-loader.js';
import { setColorEnabled, fail } from './output.js';
import type { PortQueue } from '@portqueue/core';
import * as cmd from './commands.js';

type Handler = (pq: PortQueue, flags: Record<string, string | boolean>) => Promise<void>;

// Commands that do not need a persistent connection loop can shut down after running.
const HANDLERS: Record<string, Handler> = {
  stats: cmd.statsCommand,
  queues: cmd.queuesCommand,
  jobs: cmd.jobsCommand,
  job: cmd.jobCommand,
  schedules: cmd.schedulesCommand,
  add: cmd.addCommand,
  retry: cmd.retryCommand,
  cancel: cmd.cancelCommand,
  remove: cmd.removeCommand,
  purge: cmd.purgeCommand,
  pause: cmd.pauseCommand,
  resume: cmd.resumeCommand,
  migrate: (pq) => cmd.migrateCommand(pq),
  doctor: (pq) => cmd.doctorCommand(pq),
  listen: cmd.listenCommand,
  dashboard: cmd.dashboardCommand,
};

// Long-running commands should not shut the client down when they return.
const PERSISTENT = new Set(['listen', 'dashboard']);
const PERSISTENT_WATCH = 'watch';

const HELP = `
portqueue — operate and monitor a PortQueue instance.

Usage: portqueue <command> [--flags]

Monitoring:
  stats [--queue <name>] [--watch]      State counts, throughput, failure rate
  queues                                List queues with counts + paused state
  jobs --queue <name> [--status ...]    Paged job list
  job --id <jobId>                      Full job detail
  schedules --queue <name>              List recurring definitions

Actions (destructive ones need --yes):
  add --queue <name> --data <json|@file> [--priority --delay --idempotency-key
      --schedule-key <k> (--cron "<expr>" | --every <ms>) --timezone <tz>]
  retry --id <jobId> [--from failed|start]
  cancel --id <jobId>
  remove (--id <jobId> | --schedule-id <id> --queue <name>)
  purge --queue <name> --status <status> --yes
  pause --queue <name> [--mode processing|all]  /  resume --queue <name>

Operational:
  migrate [--mode auto|validate-only]
  doctor
  listen [--queue <name>]               Stream events infinitely
  dashboard --port <n> --root-user <u> --root-password <p> [--read-only --base-path]

Global flags:
  --config <path>   Path to your portqueue.config.{js,mjs,cjs} (auto-discovered otherwise)
  --export <name>   Named export to use instead of default
  --json            Machine-readable output
  --no-color        Disable ANSI color
`;

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const commandName = parsed.command[0];

  if (!commandName || commandName === 'help' || flagBool(parsed.flags, 'help')) {
    process.stdout.write(HELP);
    return 0;
  }
  if (flagBool(parsed.flags, 'no-color')) setColorEnabled(false);

  const handler = HANDLERS[commandName];
  if (!handler) {
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
    await handler(pq, parsed.flags);
    const persistent = PERSISTENT.has(commandName) || flagBool(parsed.flags, PERSISTENT_WATCH);
    if (!persistent) await pq.shutdown();
    return 0;
  } catch (err) {
    if (err instanceof CliError) fail(err.message);
    else
      fail(
        `${(err as Error).message}${flagString(parsed.flags, 'log-level') === 'debug' ? `\n${(err as Error).stack}` : ''}`,
      );
    if (pq) await pq.shutdown().catch(() => undefined);
    return 1;
  }
}
