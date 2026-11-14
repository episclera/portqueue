import { secondsToMs } from '@portqueue/core';
import { flagBool, flagString } from '../args';
import { colorStatus, fail, heading, printJson, table, warn } from '../output';
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
      //
      // A failed refresh is reported and the watch carries on: left to reject, it was an unhandled
      // rejection that killed the process without the drain. A refresh still in flight is not
      // stacked on, so a slow database cannot pile up overlapping reads.
      let inFlight = false;
      const refresh = (): void => {
        if (inFlight) return;
        inFlight = true;
        render()
          .catch((err: unknown) => fail(`Refresh failed: ${(err as Error).message}`))
          .finally(() => {
            inFlight = false;
          });
      };
      const timer = setInterval(refresh, secondsToMs(WATCH_INTERVAL_SECONDS, '--watch interval'));
      onExit(() => clearInterval(timer));
      await new Promise(() => {}); // until interrupted; the runner's signal handler exits
    }
  },
};
