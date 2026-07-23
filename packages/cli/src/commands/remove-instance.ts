import { success, warn } from '../output.js';
import { requireFlag } from './helpers.js';
import { CommandGroup, type Command } from './types.js';

/** `portqueue remove-instance --instance-key <key>` */
export const removeInstanceCommand: Command = {
  name: 'remove-instance',
  group: CommandGroup.Actions,
  summary: 'Remove a long-inactive instance from monitoring',
  usage: '--instance-key <key>',
  async run({ pq, flags }) {
    const instanceKey = requireFlag(flags, 'instance-key');
    // Core refuses (InstanceActiveError) unless the instance has been unseen for 30 minutes.
    const ok = await pq.removeInstance({ instanceKey });
    if (ok) success(`Removed instance '${instanceKey}'.`);
    else warn(`Instance '${instanceKey}' not found.`);
  },
};
