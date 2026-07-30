/** `portqueue purge` — bulk-delete a queue's jobs in the named states. Destructive, so gated. */
import { purgeCommand } from './purge';
import { makeFakePq, runCommand } from '../test-support/run-command';

describe('purgeCommand', () => {
  it('requires --yes to confirm', async () => {
    // The one command that deletes rows in bulk. A typo'd `--status` must not be able to empty a
    // queue on the first try.
    const fake = makeFakePq();
    await expect(
      purgeCommand.run({ pq: fake.pq, flags: { queue: 'emails', status: 'failed' } }),
    ).rejects.toThrow(/pass --yes/);
  });

  it('purges when confirmed', async () => {
    const { stdout, calls } = await runCommand(
      purgeCommand,
      { queue: 'emails', status: 'failed', yes: true },
      { removed: 7 },
    );
    expect(stdout).toContain('Purged 7');
    expect(calls.purge).toEqual([{ queue: 'emails', statuses: ['FAILED'] }]);
    // Purging addresses the queue by name; it must not declare it here.
    expect(calls.createQueue).toEqual([]);
  });
});
