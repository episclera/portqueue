import {
  PortQueueEvent,
  type PortQueueEventPayloads,
} from '@portqueue/core';
import { flagBool, flagString } from '../args';
import { color, heading, printJson } from '../output';
import { CommandGroup, type Command } from './types';

/** `portqueue listen [--queue] [--events ...]` — runs infinitely, streaming events. */
export const listenCommand: Command = {
  name: 'listen',
  group: CommandGroup.Operational,
  summary: 'Stream events infinitely',
  usage: '[--queue <name>]',
  persistent: true,
  async run({ pq, flags }) {
    const queue = flagString(flags, 'queue');
    const json = flagBool(flags, 'json');
    heading(`Listening${queue ? ` — ${queue}` : ''} (Ctrl+C to stop)`);
    for (const event of Object.values(PortQueueEvent)) {
      pq.on(
        event,
        (payload: PortQueueEventPayloads[typeof event]) => {
          if (json) return printJson({ event, ...payload });
          const q = (payload as { queue?: string }).queue ?? '';
          process.stdout.write(
            `${color(new Date().toISOString(), 'dim')} ${color(event, 'cyan')} ${q}\n`,
          );
        },
        queue ? { queue } : undefined,
      );
    }
    await new Promise(() => {});
  },
};
