import { flagBool, flagNumber, flagString } from '../args.js';
import { printJson, relativeTime, success } from '../output.js';
import { requireFlag } from './helpers.js';
import { CommandGroup, type Command } from './types.js';

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
    '--queue <name> --data <json|@file> [--priority --delay --idempotency-key\n' +
    '      --schedule-key <k> (--cron "<expr>" | --every <ms>) --timezone <tz>]',
  async run({ pq, flags }) {
    const queue = requireFlag(flags, 'queue');
    const data = await parseData(requireFlag(flags, 'data'));

    const options: Record<string, unknown> = { data };
    if (flagNumber(flags, 'priority') !== undefined) options.priority = flagNumber(flags, 'priority');
    if (flagNumber(flags, 'delay') !== undefined) options.delay = flagNumber(flags, 'delay');
    if (flagNumber(flags, 'retry-max-attempts') !== undefined) {
      options.retryMaxAttempts = flagNumber(flags, 'retry-max-attempts');
    }
    if (flagString(flags, 'idempotency-key')) {
      options.idempotencyKey = flagString(flags, 'idempotency-key');
    }

    const scheduleKey = flagString(flags, 'schedule-key');
    if (scheduleKey) {
      const cron = flagString(flags, 'cron');
      const every = flagNumber(flags, 'every');
      options.schedule = {
        key: scheduleKey,
        ...(cron ? { cron } : {}),
        ...(every ? { every } : {}),
        ...(flagString(flags, 'timezone') ? { timezone: flagString(flags, 'timezone') } : {}),
      };
    }

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
