import { flagBool, flagString } from '../args';
import { CliError } from '../errors';
import { colorStatus, heading, printJson, relativeTime, table } from '../output';
import { PAGE_USAGE, pageFlags, parseStatus, printMoreHint, requireFlag } from './helpers';
import { CommandGroup, type Command } from './types';

/** `portqueue jobs [--queue] [--status] [--schedule-id] [--limit --offset]` */
export const jobsCommand: Command = {
  name: 'jobs',
  group: CommandGroup.Monitoring,
  summary: 'Paged job list',
  usage: `--queue <name> [--status <s>] [--schedule-id <id>] ${PAGE_USAGE}`,
  async run({ pq, flags }) {
    const status = parseStatus(flagString(flags, 'status'));
    const page = await pq.getJobs({
      ...(flagString(flags, 'queue') ? { queue: flagString(flags, 'queue')! } : {}),
      ...(status ? { statuses: [status] } : {}),
      ...(flagString(flags, 'schedule-id')
        ? { scheduleId: flagString(flags, 'schedule-id')! }
        : {}),
      ...pageFlags(flags),
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
    printMoreHint(page, pageFlags(flags).offset);
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
