import { flagBool } from '../args.js';
import { color, heading, printJson, table } from '../output.js';
import { CommandGroup, type Command } from './types.js';

/** `portqueue queues` */
export const queuesCommand: Command = {
  name: 'queues',
  group: CommandGroup.Monitoring,
  summary: 'List queues with counts + paused state',
  async run({ pq, flags }) {
    const queues = await pq.getQueues();
    if (flagBool(flags, 'json')) return printJson(queues);
    heading('Queues');
    table(
      ['Name', 'Pending', 'Active', 'Completed', 'Failed', 'Paused'],
      queues.map((q) => [
        q.name,
        String(q.counts.PENDING),
        String(q.counts.ACTIVE),
        String(q.counts.COMPLETED),
        String(q.counts.FAILED),
        q.acceptingPaused ? 'ALL' : q.processingPaused ? 'PROCESSING' : color('no', 'dim'),
      ]),
    );
  },
};
