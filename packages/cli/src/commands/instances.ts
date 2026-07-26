import { flagBool, flagString } from '../args';
import { CliError } from '../errors';
import { color, heading, printJson, relativeTime, table } from '../output';
import { CommandGroup, type Command } from './types';
import type { InstanceInfo } from '@portqueue/core';

/**
 * Health metrics describe the **machine** an instance runs on, and are recorded on every heartbeat,
 * so an unseen instance still reports the numbers from the last beat we heard. Before an instance's
 * first beat they are null, which prints as `—` rather than a misleading `0`.
 */
function percent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function processed(instance: InstanceInfo): number {
  return Object.values(instance.counts).reduce((sum, n) => sum + n, 0);
}

/** `portqueue instances` */
export const instancesCommand: Command = {
  name: 'instances',
  group: CommandGroup.Monitoring,
  summary: 'List instances with liveness, host health and jobs processed',
  async run({ pq, flags }) {
    const instances = await pq.getInstances();
    if (flagBool(flags, 'json')) return printJson(instances);
    heading('Instances');
    table(
      ['Instance', 'Live', 'Paused', 'CPU', 'Memory', 'Processed', 'Last Seen'],
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
  summary: 'One instance: host health at its last heartbeat + jobs by status',
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
        // Named as machine-wide, since the same numbers repeat for two instances on one host.
        ['CPU (machine)', percent(instance.cpuPercent)],
        ['Memory (machine)', percent(instance.memoryPercent)],
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
