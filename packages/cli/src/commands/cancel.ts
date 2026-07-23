import { flagString } from '../args';
import { CliError } from '../errors';
import { success, warn } from '../output';
import { requireFlag } from './helpers';
import { CommandGroup, type Command } from './types';

/** `portqueue cancel --id` */
export const cancelCommand: Command = {
  name: 'cancel',
  group: CommandGroup.Actions,
  summary: 'Cancel a pending or active job',
  usage: '--id <jobId>',
  async run({ pq, flags }) {
    const snap = await pq.getJob({ jobId: requireFlag(flags, 'id') });
    if (!snap) throw new CliError(`Job '${flagString(flags, 'id')}' not found.`);
    const ok = await pq.createQueue(snap.queue).cancelJob({ jobId: snap.id });
    if (ok) success(`Cancelled job ${snap.id}.`);
    else warn(`Job ${snap.id} could not be cancelled (already running or finished).`);
  },
};
