import { flagString } from '../args';
import { CliError } from '../errors';
import { success, warn } from '../output';
import { requireFlag } from './helpers';
import { CommandGroup, type Command } from './types';

/** `portqueue remove (--id <jobId> | --schedule-id <id> --queue <name>)` */
export const removeCommand: Command = {
  name: 'remove',
  group: CommandGroup.Actions,
  summary: 'Remove a job or a schedule',
  usage: '(--id <jobId> | --schedule-id <id> --queue <name>)',
  async run({ pq, flags }) {
    const id = flagString(flags, 'id');
    const scheduleId = flagString(flags, 'schedule-id');
    if ((id && scheduleId) || (!id && !scheduleId)) {
      throw new CliError('remove requires exactly one of --id (a job) or --schedule-id (a schedule).');
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
  },
};
