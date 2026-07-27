import { flagBool, flagNumber } from '../args';
import { color, heading, printJson, table } from '../output';
import { CommandGroup, type Command } from './types';

/** `portqueue queues [--limit <n> --offset <n>]` */
export const queuesCommand: Command = {
  name: 'queues',
  group: CommandGroup.Monitoring,
  summary: 'List queues with counts + paused state',
  usage: '[--limit <n> --offset <n>]',
  async run({ pq, flags }) {
    const limit = flagNumber(flags, 'limit');
    const offset = flagNumber(flags, 'offset');
    const page = await pq.getQueues({
      ...(limit ? { limit } : {}),
      ...(offset ? { offset } : {}),
    });
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
    // The page carries no "hasMore" flag — the next offset is past the end or it isn't.
    const next = (offset ?? 0) + page.items.length;
    if (next < page.total) {
      process.stdout.write(color(`\n… more — use --offset ${next}\n`, 'dim'));
    }
  },
};
