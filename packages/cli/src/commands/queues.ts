import { flagBool } from '../args';
import { color, heading, printJson, table } from '../output';
import { PAGE_USAGE, pageFlags, printMoreHint } from './helpers';
import { CommandGroup, type Command } from './types';

/** `portqueue queues [--limit <n> --offset <n>]` */
export const queuesCommand: Command = {
  name: 'queues',
  group: CommandGroup.Monitoring,
  summary: 'List queues with counts + paused state',
  usage: PAGE_USAGE,
  async run({ pq, flags }) {
    const page = await pq.getQueues({ ...pageFlags(flags) });
    if (flagBool(flags, 'json')) return printJson(page);
    heading('Queues');
    table(
      ['Name', 'Pending', 'Active', 'Completed', 'Failed', 'Paused'],
      page.items.map((q) => [
        q.name,
        String(q.counts.PENDING),
        String(q.counts.ACTIVE),
        String(q.counts.COMPLETED),
        String(q.counts.FAILED),
        q.acceptingPaused ? 'ALL' : q.processingPaused ? 'PROCESSING' : color('no', 'dim'),
      ]),
    );
    printMoreHint(page, pageFlags(flags).offset);
  },
};
