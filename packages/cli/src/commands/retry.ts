import { CliError } from '../errors';
import { success } from '../output';
import { requireFlag } from './helpers';
import { CommandGroup, type Command } from './types';

/** `portqueue retry --id <jobId>` — re-arm a settled job so it runs again. */
export const retryCommand: Command = {
  name: 'retry',
  group: CommandGroup.Actions,
  summary: 'Requeue a failed job',
  usage: '--id <jobId>',
  async run({ pq, flags }) {
    const jobId = requireFlag(flags, 'id');
    // Act first, explain second. `retryJob` already refuses both an unknown id and a running one,
    // so reading the row up front costs a round trip on the happy path and opens a window in which
    // the status changes — which is how the error came to name a state the job was no longer in.
    const res = await pq.retryJob({ jobId });
    if (res) {
      success(`Requeued job ${res.jobId} on queue ${res.queue}.`);
      return;
    }
    // Only now, and only to say *why*: a running job is never re-armed, because clearing its lock
    // would let a second worker claim it.
    const snap = await pq.getJob({ jobId });
    if (!snap) throw new CliError(`Job '${jobId}' not found.`);
    throw new CliError(
      `Job ${jobId} is ${snap.status} and cannot be requeued. Cancel it first, then retry once ` +
        `it has settled.`,
    );
  },
};
