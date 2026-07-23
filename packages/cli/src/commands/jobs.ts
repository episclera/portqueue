import { flagBool, flagNumber, flagString } from '../args';
import { CliError } from '../errors';
import { color, colorStatus, heading, printJson, relativeTime, table } from '../output';
import { parseStatus, requireFlag } from './helpers';
import { CommandGroup, type Command } from './types';

/** `portqueue jobs [--queue] [--status] [--schedule-id] [--limit --cursor]` */
export const jobsCommand: Command = {
  name: 'jobs',
  group: CommandGroup.Monitoring,
  summary: 'Paged job list',
  usage: '--queue <name> [--status <s>] [--schedule-id <id>] [--limit <n> --cursor <c>]',
  async run({ pq, flags }) {
    const status = parseStatus(flagString(flags, 'status'));
    const page = await pq.getJobs({
      ...(flagString(flags, 'queue') ? { queue: flagString(flags, 'queue')! } : {}),
      ...(status ? { statuses: [status] } : {}),
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
    if (page.hasMore) {
      process.stdout.write(color(`\n… more — use --cursor ${page.cursor}\n`, 'dim'));
    }
  },
};

/** `portqueue job --id <jobId>` */
export const jobCommand: Command = {
  name: 'job',
  group: CommandGroup.Monitoring,
  summary: 'Full job detail',
  usage: '--id <jobId>',
  async run({ pq, flags }) {
    const snap = await pq.getJob({ jobId: requireFlag(flags, 'id') });
    if (!snap) throw new CliError(`Job '${flagString(flags, 'id')}' not found.`);
    if (flagBool(flags, 'json')) return printJson(snap);
    heading(`Job ${snap.id}`);
    printJson(snap);
  },
};
