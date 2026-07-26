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
    // Read through the CLI facade: `createQueue` would register the queue in this admin process,
    // which listing schedules has no business doing. Dropping `--queue` now lists every queue's.
    const list = await pq._cli.getSchedules(queue ? { queue } : {});
    if (flagBool(flags, 'json')) return printJson(list);
    heading(`Schedules${queue ? ` — ${queue}` : ' (all queues)'}`);
    table(
      ['Schedule ID', 'Queue', 'Cron/Every', 'Next Run', 'Enabled'],
      list.map((s) => [
        s.scheduleId,
        s.queue,
        s.cron ?? `every ${s.everySeconds}s`,
        relativeTime(s.nextRunAt ?? null),
        s.enabled ? 'yes' : 'no',
      ]),
    );
  },
};
