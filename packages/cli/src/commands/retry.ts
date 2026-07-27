import { CliError } from '../errors';
import { success } from '../output';
import { requireFlag } from './helpers';
import { flagString } from '../args';
import { CommandGroup, type Command } from './types';

/** `portqueue retry --id <jobId>` — re-arm a failed/completed job so it runs again. */
export const retryCommand: Command = {
  name: 'retry',
  group: CommandGroup.Actions,
  summary: 'Requeue a failed job',
  usage: '--id <jobId>',
  async run({ pq, flags }) {
    const snap = await pq.getJob({ jobId: requireFlag(flags, 'id') });
    if (!snap) throw new CliError(`Job '${flagString(flags, 'id')}' not found.`);
    const res = await pq.createQueue({ name: snap.queue }).retryJob({ jobId: snap.id });
    success(`Requeued job ${snap.id} → ${res.jobId}.`);
  },
};
