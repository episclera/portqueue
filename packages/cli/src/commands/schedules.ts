import { flagBool, flagString } from '../args';
import { heading, printJson, relativeTime, table } from '../output';
import { PAGE_USAGE, pageFlags, printMoreHint } from './helpers';
import { CommandGroup, type Command } from './types';

/** `portqueue schedules [--queue <name>] [--limit <n> --offset <n>]` */
export const schedulesCommand: Command = {
  name: 'schedules',
  group: CommandGroup.Monitoring,
  summary: 'List recurring definitions',
  usage: `[--queue <name>] ${PAGE_USAGE}`,
  async run({ pq, flags }) {
    const queue = flagString(flags, 'queue');
    const window = pageFlags(flags);
    // A page, not the whole table: this used to read every schedule row in the database into the
    // terminal. Dropping `--queue` lists every queue's, and `--limit`/`--offset` walk the rest —
    // without them a deployment with more than one page of schedules looked like it had one.
    const page = await pq._cli.getSchedules({ ...(queue ? { queue } : {}), ...window });
    if (flagBool(flags, 'json')) return printJson(page);
    heading(
      `Schedules${queue ? ` — ${queue}` : ' (all queues)'} — showing ${page.items.length} of ${page.total}`,
    );
    table(
      ['Schedule ID', 'Queue', 'Cron/Every', 'Next Run', 'Enabled'],
      page.items.map((s) => [
        s.scheduleId,
        s.queue,
        s.cron ?? `every ${s.everySeconds}s`,
        relativeTime(s.nextRunAt ?? null),
        s.enabled ? 'yes' : 'no',
      ]),
    );
    printMoreHint(page, window.offset);
  },
};
