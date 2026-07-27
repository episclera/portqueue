import { flagBool, flagString } from '../args';
import { CliError } from '../errors';
import { color, heading, printJson, relativeTime, table } from '../output';
import { CommandGroup, type Command } from './types';
import type { InstanceInfo } from '@portqueue/core';

/** Where a health reading stops being comfortable — the same two points the dashboard uses. */
const METRIC_WARN_PERCENT = 75;
const METRIC_DANGER_PERCENT = 85;

/**
 * Health metrics describe the **Node process** an instance runs — CPU as a share of the cores
 * available to it, heap as a share of V8's limit — and are recorded on every heartbeat, so an
 * unseen instance still reports the numbers from the last beat we heard. Before an instance's first
 * beat they are null, which prints as `—` rather than a misleading `0`.
 *
 * Both are 0-100 shares of a ceiling the process can't pass, so one pair of thresholds colours
 * both: yellow from 75, red from 85.
 */
function percent(value: number | null): string {
  if (value === null) return '—';
  const text = `${value.toFixed(1)}%`;
  if (value >= METRIC_DANGER_PERCENT) return color(text, 'red');
  if (value >= METRIC_WARN_PERCENT) return color(text, 'yellow');
  return text;
}

function processed(instance: InstanceInfo): number {
  return Object.values(instance.counts).reduce((sum, n) => sum + n, 0);
}

/** `portqueue instances` */
export const instancesCommand: Command = {
  name: 'instances',
  group: CommandGroup.Monitoring,
  summary: 'List instances with liveness, process health and jobs processed',
  async run({ pq, flags }) {
    const instances = await pq.getInstances();
    if (flagBool(flags, 'json')) return printJson(instances);
    heading('Instances');
    table(
      // The two health columns say whose numbers they are in the header, since a bare "CPU" in a
      // terminal reads as the box's load.
      ['Instance', 'Live', 'Paused', 'CPU (proc)', 'Mem (proc)', 'Processed', 'Last Seen'],
      instances.map((i) => [
        i.instanceKey,
        i.alive ? 'yes' : color('no', 'dim'),
        i.processingPaused ? 'yes' : color('no', 'dim'),
        percent(i.cpuPercent),
        percent(i.memoryPercent),
        String(processed(i)),
        relativeTime(i.lastSeenAt),
      ]),
    );
  },
};

/** `portqueue instance --key <instanceKey>` */
export const instanceCommand: Command = {
  name: 'instance',
  group: CommandGroup.Monitoring,
  summary: 'One instance: process health at its last heartbeat + jobs by status',
  usage: '--key <instanceKey>',
  async run({ pq, flags }) {
    const instanceKey = flagString(flags, 'key');
    if (!instanceKey) throw new CliError('Missing required --key.');
    // Read through the list rather than a by-key lookup: the public API has no single-instance
    // read, and the instances table is a handful of rows by nature.
    const instance = (await pq.getInstances()).find((i) => i.instanceKey === instanceKey);
    if (!instance) throw new CliError(`Instance '${instanceKey}' not found.`);
    if (flagBool(flags, 'json')) return printJson(instance);

    heading(`Instance ${instance.instanceKey}`);
    table(
      ['Property', 'Value'],
      [
        ['Live', instance.alive ? 'yes' : color('no', 'dim')],
        ['Paused', instance.processingPaused ? 'yes' : color('no', 'dim')],
        // Spelled out here, where there is room: a share of the cores available, and a share of
        // V8's heap limit — neither is the machine's.
        ['CPU (process, % of all cores)', percent(instance.cpuPercent)],
        ['Memory (process, % of heap limit)', percent(instance.memoryPercent)],
        ['Last seen', relativeTime(instance.lastSeenAt)],
        ['First seen', relativeTime(instance.createdAt)],
      ],
    );
    heading('Jobs processed');
    const counts = Object.entries(instance.counts).filter(([, n]) => n > 0);
    table(
      ['Status', 'Count'],
      counts.length
        ? [
            ...counts.map(([status, n]) => [status, String(n)]),
            ['TOTAL', String(processed(instance))],
          ]
        : [['—', '0']],
    );
  },
};
