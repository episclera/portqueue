import { success, warn } from '../output';
import { requireFlag } from './helpers';
import { CommandGroup, type Command } from './types';

/** `portqueue remove-queue --queue <name>` */
export const removeQueueCommand: Command = {
  name: 'remove-queue',
  group: CommandGroup.Actions,
  summary: 'Remove a queue no longer used by any running code',
  usage: '--queue <name>',
  async run({ pq, flags }) {
    const queue = requireFlag(flags, 'queue');
    // The CLI is a separate admin process that never declared the app's queues, so the in-use
    // guard passes; core still refuses (QueueInUseError) if a running client references it.
    const ok = await pq.removeQueue({ name: queue });
    if (ok) success(`Removed queue '${queue}'.`);
    else warn(`Queue '${queue}' not found.`);
  },
};
