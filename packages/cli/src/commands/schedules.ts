import { flagBool, flagString } from '../args.js';
import { CliError } from '../errors.js';
import { heading, printJson, relativeTime, table } from '../output.js';
import { CommandGroup, type Command } from './types.js';

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
      ['Key', 'Cron/Every', 'Next Run', 'Enabled'],
      list.map((s) => [
        s.key,
        s.cron ?? `every ${s.every}ms`,
        relativeTime(s.nextRunAt ?? null),
        s.enabled ? 'yes' : 'no',
      ]),
    );
  },
};
