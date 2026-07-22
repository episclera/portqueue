import { success } from '../output.js';
import { CommandGroup, type Command } from './types.js';

/** `portqueue migrate [--mode auto|validate-only]` */
export const migrateCommand: Command = {
  name: 'migrate',
  group: CommandGroup.Operational,
  summary: 'Apply pending schema migrations',
  usage: '[--mode auto|validate-only]',
  async run({ pq }) {
    await pq.migrate();
    success('Migrations applied (or already up to date).');
  },
};
