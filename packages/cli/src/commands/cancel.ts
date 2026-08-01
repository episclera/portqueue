import { CancelOutcome } from '@portqueue/core';
import { success, warn } from '../output';
import { requireFlag } from './helpers';
import { CommandGroup, type Command } from './types';

/** `portqueue cancel --id` */
export const cancelCommand: Command = {
  name: 'cancel',
  group: CommandGroup.Actions,
  summary: 'Cancel a pending job, or ask a running one to stop',
  usage: '--id <jobId>',
  async run({ pq, flags }) {
    const jobId = requireFlag(flags, 'id');
    // No read first: `cancelJob` throws for an id that names nothing and otherwise reports exactly
    // what it did, so a pre-read would only add a round trip — and a window in which the status
    // could change, making the message wrong.
    switch (await pq.cancelJob({ jobId })) {
      case CancelOutcome.CANCELLED:
        success(`Cancelled job ${jobId}.`);
        break;
      case CancelOutcome.SIGNALLED:
        // Worth saying plainly rather than reporting a success: the handler may finish anyway.
        warn(
          `Job ${jobId} is running in this process and was asked to stop. It only stops if its ` +
            `handler observes job.signal — check the job to see what it became.`,
        );
        break;
      default:
        warn(`Job ${jobId} could not be cancelled (already finished, or running elsewhere).`);
    }
  },
};
