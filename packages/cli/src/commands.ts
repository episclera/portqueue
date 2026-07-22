import { createServer } from 'node:http';
import {
  JobStatus,
  PauseMode,
  PortQueueEvent,
  RetryMode,
  type PortQueue,
  type PortQueueEventPayloads,
} from '@portqueue/core';
import { flagBool, flagNumber, flagString, type ParsedArgs } from './args.js';
import { CliError } from './config-loader.js';
import {
  color,
  colorStatus,
  fail,
  heading,
  printJson,
  relativeTime,
  success,
  table,
  warn,
} from './output.js';

type Flags = ParsedArgs['flags'];

function parseStatus(value: string | undefined): JobStatus | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  if ((Object.values(JobStatus) as string[]).includes(upper)) return upper as JobStatus;
  throw new CliError(`Unknown status '${value}'. Valid: ${Object.values(JobStatus).join(', ')}.`);
}

function requireFlag(flags: Flags, name: string): string {
  const v = flagString(flags, name);
  if (!v) throw new CliError(`Missing required --${name}.`);
  return v;
}

/** `portqueue stats [--queue] [--watch]` */
export async function statsCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const queue = flagString(flags, 'queue');
  const render = async () => {
    const stats = await pq.getQueueStats(queue ? { queue } : {});
    if (flagBool(flags, 'json')) return printJson(stats);
    heading(`Stats${queue ? ` — ${queue}` : ' (all queues)'}`);
    const rows = Object.entries(stats.counts).map(([status, count]) => [
      colorStatus(status),
      String(count),
    ]);
    table(['State', 'Count'], rows);
    process.stdout.write(
      `\n${color('throughput', 'dim')} ${stats.throughputPerMinute.toFixed(1)}/min   ` +
        `${color('failure rate', 'dim')} ${(stats.failureRate * 100).toFixed(1)}%\n`,
    );
  };
  await render();
  if (flagBool(flags, 'watch')) {
    warn('Watching — press Ctrl+C to stop.');
    setInterval(() => void render(), 2000);
    await new Promise(() => {}); // run until interrupted
  }
}

/** `portqueue queues` */
export async function queuesCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const queues = await pq.getQueues();
  if (flagBool(flags, 'json')) return printJson(queues);
  heading('Queues');
  table(
    ['Name', 'Pending', 'Active', 'Completed', 'Failed', 'Paused'],
    queues.map((q) => [
      q.name,
      String(q.counts.PENDING),
      String(q.counts.ACTIVE),
      String(q.counts.COMPLETED),
      String(q.counts.FAILED),
      q.acceptingPaused ? 'ALL' : q.processingPaused ? 'PROCESSING' : color('no', 'dim'),
    ]),
  );
}

/** `portqueue jobs --queue <name> [--status] [--schedule-id] [--limit --cursor]` */
export async function jobsCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const page = await pq.getJobs({
    ...(flagString(flags, 'queue') ? { queue: flagString(flags, 'queue')! } : {}),
    ...(parseStatus(flagString(flags, 'status'))
      ? { statuses: [parseStatus(flagString(flags, 'status'))!] }
      : {}),
    ...(flagString(flags, 'schedule-id') ? { scheduleId: flagString(flags, 'schedule-id')! } : {}),
    ...(flagNumber(flags, 'limit') ? { limit: flagNumber(flags, 'limit')! } : {}),
    ...(flagString(flags, 'cursor') ? { cursor: flagString(flags, 'cursor')! } : {}),
  });
  if (flagBool(flags, 'json')) return printJson(page);
  heading('Jobs');
  table(
    ['ID', 'Status', 'Attempt', 'Created'],
    page.items.map((j) => [
      j.id.slice(0, 12),
      colorStatus(j.status),
      `${j.retryAttempt}/${j.retryMaxAttempts}`,
      relativeTime(j.createdAt),
    ]),
  );
  if (page.hasMore) process.stdout.write(color(`\n… more — use --cursor ${page.cursor}\n`, 'dim'));
}

/** `portqueue job --id <jobId>` */
export async function jobCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const snap = await pq.getJob({ jobId: requireFlag(flags, 'id') });
  if (!snap) throw new CliError(`Job '${flagString(flags, 'id')}' not found.`);
  if (flagBool(flags, 'json')) return printJson(snap);
  heading(`Job ${snap.id}`);
  printJson(snap);
}

/** `portqueue schedules [--queue]` */
export async function schedulesCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const queue = flagString(flags, 'queue');
  if (!queue) throw new CliError('schedules requires --queue <name>.');
  const list = await pq.createQueue(queue).getSchedules();
  if (flagBool(flags, 'json')) return printJson(list);
  heading(`Schedules — ${queue}`);
  table(
    ['Key', 'Cron/Every', 'Next Run', 'Enabled'],
    list.map((s) => [
      s.key,
      s.cron ?? `every ${s.every}ms`,
      relativeTime(s.nextRunAt ?? null),
      s.enabled ? 'yes' : 'no',
    ]),
  );
}

/** `portqueue add --queue --data <json|@file> [job/schedule flags]` */
export async function addCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const queue = requireFlag(flags, 'queue');
  const raw = requireFlag(flags, 'data');
  let data: unknown;
  if (raw.startsWith('@')) {
    const { readFileSync } = await import('node:fs');
    data = JSON.parse(readFileSync(raw.slice(1), 'utf8'));
  } else {
    data = JSON.parse(raw);
  }
  const scheduleKey = flagString(flags, 'schedule-key');
  const options: Record<string, unknown> = { data };
  if (flagNumber(flags, 'priority') !== undefined) options.priority = flagNumber(flags, 'priority');
  if (flagNumber(flags, 'delay') !== undefined) options.delay = flagNumber(flags, 'delay');
  if (flagNumber(flags, 'retry-max-attempts') !== undefined)
    options.retryMaxAttempts = flagNumber(flags, 'retry-max-attempts');
  if (flagString(flags, 'idempotency-key'))
    options.idempotencyKey = flagString(flags, 'idempotency-key');
  if (scheduleKey) {
    const cron = flagString(flags, 'cron');
    const every = flagNumber(flags, 'every');
    options.schedule = {
      key: scheduleKey,
      ...(cron ? { cron } : {}),
      ...(every ? { every } : {}),
      ...(flagString(flags, 'timezone') ? { timezone: flagString(flags, 'timezone') } : {}),
    };
  }
  const result = await pq.createQueue(queue).addJob(options as never);
  if (flagBool(flags, 'json')) return printJson(result);
  if (result.scheduleId)
    success(
      `Schedule ${result.scheduleId} created (next run ${relativeTime(result.nextRunAt ?? null)}).`,
    );
  else success(`Job ${result.jobId} added${result.deduplicated ? ' (deduplicated)' : ''}.`);
}

/** `portqueue retry --id [--from failed|start]` */
export async function retryCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const from =
    flagString(flags, 'from') === 'start' ? RetryMode.FROM_START : RetryMode.FROM_FAILED_STEP;
  const snap = await pq.getJob({ jobId: requireFlag(flags, 'id') });
  if (!snap) throw new CliError(`Job '${flagString(flags, 'id')}' not found.`);
  const res = await pq.createQueue(snap.queue).retryJob({ jobId: snap.id, from });
  success(`Requeued job ${snap.id} (${from}) → ${res.jobId}.`);
}

/** `portqueue cancel --id` */
export async function cancelCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const snap = await pq.getJob({ jobId: requireFlag(flags, 'id') });
  if (!snap) throw new CliError(`Job '${flagString(flags, 'id')}' not found.`);
  const ok = await pq.createQueue(snap.queue).cancelJob({ jobId: snap.id });
  if (ok) success(`Cancelled job ${snap.id}.`);
  else warn(`Job ${snap.id} could not be cancelled (already running or finished).`);
}

/** `portqueue remove (--id | --schedule-id)` */
export async function removeCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const id = flagString(flags, 'id');
  const scheduleId = flagString(flags, 'schedule-id');
  if ((id && scheduleId) || (!id && !scheduleId)) {
    throw new CliError(
      'remove requires exactly one of --id (a job) or --schedule-id (a schedule).',
    );
  }
  if (id) {
    const snap = await pq.getJob({ jobId: id });
    if (!snap) throw new CliError(`Job '${id}' not found.`);
    const ok = await pq.createQueue(snap.queue).removeJob({ jobId: id });
    if (ok) success(`Removed job ${id}.`);
    else warn(`Job ${id} not removed.`);
  } else {
    const queue = requireFlag(flags, 'queue');
    const ok = await pq.createQueue(queue).removeSchedule({ scheduleId: scheduleId! });
    if (ok) success(`Removed schedule ${scheduleId}.`);
    else warn(`Schedule ${scheduleId} not found.`);
  }
}

/** `portqueue purge --queue --status [--older-than]` */
export async function purgeCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const queue = requireFlag(flags, 'queue');
  const status = parseStatus(requireFlag(flags, 'status'));
  if (!flagBool(flags, 'yes')) throw new CliError('purge is destructive — pass --yes to confirm.');
  const n = await pq.createQueue(queue).purgeJobs({ statuses: [status!] });
  success(`Purged ${n} ${status} job(s) from '${queue}'.`);
}

/** `portqueue pause --queue [--mode processing|all]` / `resume` */
export async function pauseCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const queue = requireFlag(flags, 'queue');
  const mode = flagString(flags, 'mode') === 'all' ? PauseMode.ALL : PauseMode.PROCESSING;
  await pq.pauseQueue({ queue, mode });
  success(`Paused '${queue}' (${mode}).`);
}
export async function resumeCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const queue = requireFlag(flags, 'queue');
  await pq.resumeQueue({ queue });
  success(`Resumed '${queue}'.`);
}

/** `portqueue migrate [--mode auto|validate-only]` */
export async function migrateCommand(pq: PortQueue): Promise<void> {
  await pq.migrate();
  success('Migrations applied (or already up to date).');
}

/** `portqueue doctor` */
export async function doctorCommand(pq: PortQueue): Promise<void> {
  heading('PortQueue doctor');
  const queues = await pq.getQueues();
  success(`Connected. ${queues.length} queue(s) registered.`);
  success('Schema is current (init ran migrations).');
}

/** `portqueue listen [--queue] [--events ...]` — runs infinitely, streaming events. */
export async function listenCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const queue = flagString(flags, 'queue');
  const json = flagBool(flags, 'json');
  heading(`Listening${queue ? ` — ${queue}` : ''} (Ctrl+C to stop)`);
  for (const event of Object.values(PortQueueEvent)) {
    pq.on(
      event,
      (payload: PortQueueEventPayloads[typeof event]) => {
        if (json) return printJson({ event, ...payload });
        const q = (payload as { queue?: string }).queue ?? '';
        process.stdout.write(
          `${color(new Date().toISOString(), 'dim')} ${color(event, 'cyan')} ${q}\n`,
        );
      },
      queue ? { queue } : undefined,
    );
  }
  await new Promise(() => {});
}

/** `portqueue dashboard --port [--root-user --root-password] [--read-only]` */
export async function dashboardCommand(pq: PortQueue, flags: Flags): Promise<void> {
  const port = flagNumber(flags, 'port') ?? 4321;
  const user = flagString(flags, 'root-user') ?? process.env.PORTQUEUE_ROOT_USER;
  const password = flagString(flags, 'root-password') ?? process.env.PORTQUEUE_ROOT_PASSWORD;
  if (!user || !password) {
    throw new CliError(
      'The served dashboard requires credentials. Pass --root-user and --root-password ' +
        '(or set PORTQUEUE_ROOT_USER / PORTQUEUE_ROOT_PASSWORD).',
    );
  }
  const { createDashboard } = await import('@portqueue/dashboard');
  const dashboard = createDashboard({
    portQueue: pq,
    auth: { mode: 'basic', username: user, password },
    readOnly: flagBool(flags, 'read-only'),
    ...(flagString(flags, 'base-path') ? { basePath: flagString(flags, 'base-path')! } : {}),
  });
  const handler = dashboard.node();
  const server = createServer((req, res) => {
    if (!handler(req, res)) {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
  const host = flagString(flags, 'host') ?? '127.0.0.1';
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  success(
    `Dashboard serving at http://${host}:${port}${flagString(flags, 'base-path') ?? '/portqueue'} (basic auth).`,
  );
  await new Promise(() => {});
}

export { fail };
