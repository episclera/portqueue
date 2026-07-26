import { flagBool, flagString } from '../args';
import { colorStatus, heading, printJson, table, warn } from '../output';
import { CommandGroup, type Command } from './types';

/** `portqueue stats [--queue] [--watch]` */
export const statsCommand: Command = {
  name: 'stats',
  group: CommandGroup.Monitoring,
  summary: 'Job counts by state',
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
    };
    await render();
    if (flagBool(flags, 'watch')) {
      warn('Watching — press Ctrl+C to stop.');
      setInterval(() => void render(), 2000);
      await new Promise(() => {}); // run until interrupted
    }
  },
};
