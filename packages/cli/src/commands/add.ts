import { flagBool, flagNumber, flagString } from '../args';
import { printJson, relativeTime, success } from '../output';
import { requireFlag } from './helpers';
import { CommandGroup, type Command } from './types';

/** Parse `--data` which is either inline JSON or `@path/to/file.json`. */
async function parseData(raw: string): Promise<unknown> {
  if (raw.startsWith('@')) {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(raw.slice(1), 'utf8'));
  }
  return JSON.parse(raw);
}

/** `portqueue add --queue --data <json|@file> [job/schedule flags]` */
export const addCommand: Command = {
  name: 'add',
  group: CommandGroup.Actions,
  summary: 'Enqueue a job or create a recurring schedule',
  usage:
    '--queue <name> --data <json|@file> [--priority --start-after <duration>\n' +
    '      --idempotency-key <k> | --cron "<expr>" --timezone <tz> | --every <ms>]',
  async run({ pq, flags }) {
    const queue = requireFlag(flags, 'queue');
    const data = await parseData(requireFlag(flags, 'data'));

    const options: Record<string, unknown> = { data };
    if (flagNumber(flags, 'priority') !== undefined) options.priority = flagNumber(flags, 'priority');
    const startAfter = flagString(flags, 'start-after');
    if (startAfter) options.startAfter = /^\d+$/.test(startAfter) ? Number(startAfter) : startAfter;
    if (flagNumber(flags, 'retry-max-attempts') !== undefined) {
      options.retryMaxAttempts = flagNumber(flags, 'retry-max-attempts');
    }
    if (flagString(flags, 'idempotency-key')) {
      options.idempotencyKey = flagString(flags, 'idempotency-key');
    }

    // Recurring: `--cron` (optionally with `--timezone`) or `--every <ms>`. No key needed —
    // the pattern is the identity.
    const cron = flagString(flags, 'cron');
    const timezone = flagString(flags, 'timezone');
    const every = flagNumber(flags, 'every');
    if (cron) options.cron = timezone ? { pattern: cron, tz: timezone } : cron;
    else if (every !== undefined) options.startEvery = every;

    const result = await pq.createQueue(queue).addJob(options as never);
    if (flagBool(flags, 'json')) return printJson(result);
    if (result.scheduleId) {
      success(
        `Schedule ${result.scheduleId} created (next run ${relativeTime(result.nextRunAt ?? null)}).`,
      );
    } else {
      success(`Job ${result.jobId} added${result.deduplicated ? ' (deduplicated)' : ''}.`);
    }
  },
};
