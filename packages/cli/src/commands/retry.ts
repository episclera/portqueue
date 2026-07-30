import { CliError } from '../errors';
import { success } from '../output';
import { requireFlag } from './helpers';
import { flagString } from '../args';
import { CommandGroup, type Command } from './types';

/** `portqueue retry --id <jobId>` — re-arm a settled job so it runs again. */
export const retryCommand: Command = {
  name: 'retry',
  group: CommandGroup.Actions,
  summary: 'Requeue a failed job',
  usage: '--id <jobId>',
  async run({ pq, flags }) {
    const snap = await pq.getJob({ jobId: requireFlag(flags, 'id') });
    if (!snap) throw new CliError(`Job '${flagString(flags, 'id')}' not found.`);
    const res = await pq.retryJob({ jobId: snap.id });
    // A running job is never re-armed: clearing its lock would let a second worker claim it.
    if (!res) {
      throw new CliError(
        `Job ${snap.id} is ${snap.status} and cannot be requeued. Cancel it first, then retry once ` +
          `it has settled.`,
      );
    }
    success(`Requeued job ${res.jobId} on queue ${res.queue}.`);
  },
};
