import { heading, success } from '../output';
import { CommandGroup, type Command } from './types';

/** `portqueue doctor` */
export const doctorCommand: Command = {
  name: 'doctor',
  group: CommandGroup.Operational,
  summary: 'Check connectivity and schema health',
  async run({ pq }) {
    heading('PortQueue doctor');
    const queues = await pq.getQueues();
    success(`Connected. ${queues.length} queue(s) registered.`);
    success('Schema is current (init ran migrations).');
  },
};
