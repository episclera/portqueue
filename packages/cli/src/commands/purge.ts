import { flagBool } from '../args.js';
import { CliError } from '../errors.js';
import { success } from '../output.js';
import { parseStatus, requireFlag } from './helpers.js';
import { CommandGroup, type Command } from './types.js';

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
    const n = await pq.createQueue(queue).purgeJobs({ statuses: [status!] });
    success(`Purged ${n} ${status} job(s) from '${queue}'.`);
  },
};
