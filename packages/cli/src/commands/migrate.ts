import { success } from '../output';
import { CommandGroup, type Command } from './types';

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
