import { PortQueueEvent, type PortQueueEventPayloads } from '@portqueue/core';
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
  async run({ pq, flags, onExit }) {
    const queue = flagString(flags, 'queue');
    const json = flagBool(flags, 'json');
    heading(`Listening${queue ? ` — ${queue}` : ''} (Ctrl+C to stop)`);
    const unsubscribes = Object.values(PortQueueEvent).map((event) =>
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
      ),
    );
    // Detached before the client shuts down, so the drain's own events don't print after the
    // "stopping" line — and so nothing holds a reference to this command's closure.
    onExit(() => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    });
    // Held open until a stop signal; the runner shuts the client down.
    await new Promise(() => {});
  },
};
