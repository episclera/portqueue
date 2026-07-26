import { flagBool } from '../args';
import { CliError } from '../errors';
import { success } from '../output';
import { parseStatus, requireFlag } from './helpers';
import { CommandGroup, type Command } from './types';

/** `portqueue purge --queue --status --yes` */
export const purgeCommand: Command = {
  name: 'purge',
  group: CommandGroup.Actions,
  summary: 'Delete jobs in a state (destructive — needs --yes)',
  usage: '--queue <name> --status <status> --yes',
  async run({ pq, flags }) {
    const queue = requireFlag(flags, 'queue');
    const status = parseStatus(requireFlag(flags, 'status'));
    if (!flagBool(flags, 'yes')) {
      throw new CliError('purge is destructive — pass --yes to confirm.');
    }
    // Via the CLI facade so purging doesn't register the queue in this admin process.
    const n = await pq._cli.purge({ queue, statuses: [status!] });
    success(`Purged ${n} ${status} job(s) from '${queue}'.`);
  },
};
