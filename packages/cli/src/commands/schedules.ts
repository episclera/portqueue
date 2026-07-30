import { flagBool, flagString } from '../args';
import { heading, printJson, relativeTime, table } from '../output';
import { CommandGroup, type Command } from './types';

/** `portqueue schedules [--queue <name>]` */
export const schedulesCommand: Command = {
  name: 'schedules',
  group: CommandGroup.Monitoring,
  summary: 'List recurring definitions',
  usage: '[--queue <name>]',
  async run({ pq, flags }) {
    const queue = flagString(flags, 'queue');
    // A page, not the whole table: this used to read every schedule row in the database into the
    // terminal. Dropping `--queue` lists every queue's.
    const page = await pq._cli.getSchedules(queue ? { queue } : {});
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
  },
};
