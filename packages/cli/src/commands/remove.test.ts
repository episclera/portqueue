/** `portqueue remove` — delete one job row, or one schedule. Exactly one selector, never both. */
import { removeCommand } from './remove';
import { makeFakePq, runCommand } from '../test-support/run-command';

describe('removeCommand', () => {
  it('removes a job by --id', async () => {
    const { stdout, calls } = await runCommand(removeCommand, { id: 'job-abcdef123456' });
    expect(stdout).toContain('Removed job');
    expect(calls.removeJob).toHaveLength(1);
  });

  it('warns when the job is running rather than claiming it was removed', async () => {
    const { stdout } = await runCommand(
      removeCommand,
      { id: 'job-abcdef123456' },
      { removeJobOk: false },
    );
    expect(stdout).toContain('not removed');
  });

  it('removes a schedule by --schedule-id alone', async () => {
    // The schedule row carries its own queue, so the operator never has to know it — and removing
    // one must not declare that queue in this process.
    const { stdout, calls } = await runCommand(removeCommand, { 'schedule-id': 'sch-1' });
    expect(stdout).toContain('Removed schedule sch-1');
    expect(calls.removeSchedule).toEqual([{ scheduleId: 'sch-1' }]);
    expect(calls.createQueue).toEqual([]);
  });

  it('rejects when neither or both selectors are given', async () => {
    const fake = makeFakePq();
    await expect(removeCommand.run({ pq: fake.pq, onExit: () => {}, flags: {} })).rejects.toThrow(
      /exactly one/,
    );
    await expect(
      removeCommand.run({ pq: fake.pq, onExit: () => {}, flags: { id: 'a', 'schedule-id': 'b' } }),
    ).rejects.toThrow(/exactly one/);
  });
});
