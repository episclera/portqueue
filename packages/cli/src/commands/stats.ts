import { flagBool, flagString } from '../args.js';
import { color, colorStatus, heading, printJson, table, warn } from '../output.js';
import { CommandGroup, type Command } from './types.js';

/** `portqueue stats [--queue] [--watch]` */
export const statsCommand: Command = {
  name: 'stats',
  group: CommandGroup.Monitoring,
  summary: 'State counts, throughput, failure rate',
  usage: '[--queue <name>] [--watch]',
  async run({ pq, flags }) {
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
      process.stdout.write(
        `\n${color('throughput', 'dim')} ${stats.throughputPerMinute.toFixed(1)}/min   ` +
          `${color('failure rate', 'dim')} ${(stats.failureRate * 100).toFixed(1)}%\n`,
      );
    };
    await render();
    if (flagBool(flags, 'watch')) {
      warn('Watching — press Ctrl+C to stop.');
      setInterval(() => void render(), 2000);
      await new Promise(() => {}); // run until interrupted
    }
  },
};
