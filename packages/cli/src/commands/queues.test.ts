/** `portqueue queues` — every queue with its per-status counts. */
import { queuesCommand } from './queues';
import { runCommand } from '../test-support/run-command';

describe('queuesCommand', () => {
  it('lists queues with counts', async () => {
    const { stdout } = await runCommand(queuesCommand);
    expect(stdout).toContain('emails');
    expect(stdout).toContain('Pending');
  });

  it('never declares a queue in this admin process', async () => {
    // Listing is a read. Declaring the queues it happened to list would flip their `inUse` flag and
    // trip the `removeQueue` guard for a process that is about to exit.
    const { calls } = await runCommand(queuesCommand);
    expect(calls.createQueue).toEqual([]);
  });
});
