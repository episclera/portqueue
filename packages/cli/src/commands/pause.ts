import { PauseMode } from '@portqueue/core';
import { flagString } from '../args.js';
import { success } from '../output.js';
import { requireFlag } from './helpers.js';
import { CommandGroup, type Command } from './types.js';

/** `portqueue pause --queue [--mode processing|all]` */
export const pauseCommand: Command = {
  name: 'pause',
  group: CommandGroup.Actions,
  summary: 'Pause a queue',
  usage: '--queue <name> [--mode processing|all]',
  async run({ pq, flags }) {
    const queue = requireFlag(flags, 'queue');
    const mode = flagString(flags, 'mode') === 'all' ? PauseMode.ALL : PauseMode.PROCESSING;
    await pq.pauseQueue({ queue, mode });
    success(`Paused '${queue}' (${mode}).`);
  },
};

/** `portqueue resume --queue` */
export const resumeCommand: Command = {
  name: 'resume',
  group: CommandGroup.Actions,
  summary: 'Resume a paused queue',
  usage: '--queue <name>',
  async run({ pq, flags }) {
    const queue = requireFlag(flags, 'queue');
    await pq.resumeQueue({ queue });
    success(`Resumed '${queue}'.`);
  },
};
