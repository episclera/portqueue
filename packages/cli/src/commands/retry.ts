import { RetryMode } from '@portqueue/core';
import { flagString } from '../args';
import { CliError } from '../errors';
import { success } from '../output';
import { requireFlag } from './helpers';
import { CommandGroup, type Command } from './types';

/** `portqueue retry --id [--from failed|start]` */
export const retryCommand: Command = {
  name: 'retry',
  group: CommandGroup.Actions,
  summary: 'Requeue a failed job',
  usage: '--id <jobId> [--from failed|start]',
  async run({ pq, flags }) {
    const from =
      flagString(flags, 'from') === 'start' ? RetryMode.FROM_START : RetryMode.FROM_FAILED_STEP;
    const snap = await pq.getJob({ jobId: requireFlag(flags, 'id') });
    if (!snap) throw new CliError(`Job '${flagString(flags, 'id')}' not found.`);
    const res = await pq.createQueue(snap.queue).retryJob({ jobId: snap.id, from });
    success(`Requeued job ${snap.id} (${from}) → ${res.jobId}.`);
  },
};
