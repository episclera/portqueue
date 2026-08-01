import { secondsToMs } from '@portqueue/core';
import { flagBool, flagString } from '../args';
import { colorStatus, heading, printJson, table, warn } from '../output';
import { CommandGroup, type Command } from './types';

/** How often `--watch` re-reads the counts. Seconds, like every other duration here. */
const WATCH_INTERVAL_SECONDS = 2;

/** `portqueue stats [--queue] [--watch]` */
export const statsCommand: Command = {
  name: 'stats',
  group: CommandGroup.Monitoring,
  summary: 'Job counts by state',
  usage: '[--queue <name>] [--watch]',
  async run({ pq, flags, onExit }) {
    const queue = flagString(flags, 'queue');
    const render = async () => {
      const stats = await pq.getQueueStats(queue ? { queue } : {});
      if (flagBool(flags, 'json')) return printJson(stats);
      heading(`Stats${queue ? ` — ${queue}` : ' (all queues)'}`);
      const rows = Object.entries(stats.counts).map(([status, count]) => [
        colorStatus(status),
        String(count),
      ]);
      table(['State', 'Count'], rows);
    };
    await render();
    if (flagBool(flags, 'watch')) {
      warn('Watching — press Ctrl+C to stop.');
      // The handle is handed to the runner rather than dropped: an interval nobody can clear keeps
      // the event loop alive with no way to stop it, so the client never shut down cleanly.
      const timer = setInterval(
        () => void render(),
        secondsToMs(WATCH_INTERVAL_SECONDS, '--watch interval'),
      );
      onExit(() => clearInterval(timer));
      await new Promise(() => {}); // until interrupted; the runner's signal handler exits
    }
  },
};
