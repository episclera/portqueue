import { flagString } from '../args';
import { CliError } from '../errors';
import { success, warn } from '../output';
import { CommandGroup, type Command } from './types';

/** `portqueue remove (--id <jobId> | --schedule-id <id>)` */
export const removeCommand: Command = {
  name: 'remove',
  group: CommandGroup.Actions,
  summary: 'Remove a job or a schedule',
  usage: '(--id <jobId> | --schedule-id <id>)',
  async run({ pq, flags }) {
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
      const ok = await pq.removeJob({ jobId: id });
      if (ok) success(`Removed job ${id}.`);
      else warn(`Job ${id} not removed (it is running — cancel it first).`);
    } else {
      // Removal is by id alone: the schedule row carries its own queue, so `--queue` is not needed.
      const ok = await pq.removeSchedule({ scheduleId: scheduleId! });
      if (ok) success(`Removed schedule ${scheduleId}.`);
      else warn(`Schedule ${scheduleId} not found.`);
    }
  },
};
