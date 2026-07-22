import { flagString } from '../args.js';
import { CliError } from '../errors.js';
import { success, warn } from '../output.js';
import { requireFlag } from './helpers.js';
import { CommandGroup, type Command } from './types.js';

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
