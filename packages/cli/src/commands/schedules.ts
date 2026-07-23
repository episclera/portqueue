import { flagBool, flagString } from '../args';
import { CliError } from '../errors';
import { heading, printJson, relativeTime, table } from '../output';
import { CommandGroup, type Command } from './types';

/** `portqueue schedules --queue <name>` */
export const schedulesCommand: Command = {
  name: 'schedules',
  group: CommandGroup.Monitoring,
  summary: 'List recurring definitions',
  usage: '--queue <name>',
  async run({ pq, flags }) {
    const queue = flagString(flags, 'queue');
    if (!queue) throw new CliError('schedules requires --queue <name>.');
    const list = await pq.createQueue(queue).getSchedules();
    if (flagBool(flags, 'json')) return printJson(list);
    heading(`Schedules — ${queue}`);
    table(
      ['Schedule ID', 'Cron/Every', 'Next Run', 'Enabled'],
      list.map((s) => [
        s.scheduleId,
        s.cron ?? `every ${s.every}ms`,
        relativeTime(s.nextRunAt ?? null),
        s.enabled ? 'yes' : 'no',
      ]),
    );
  },
};
