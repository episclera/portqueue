/** `portqueue cancel` — stop a job without deleting its row. */
import { CancelOutcome } from '@portqueue/core';
import { cancelCommand } from './cancel';
import { runCommand } from '../test-support/run-command';

describe('cancelCommand', () => {
  it('reports success when the row was cancelled', async () => {
    const { stdout } = await runCommand(
      cancelCommand,
      { id: 'job-abcdef123456' },
      { cancelOutcome: CancelOutcome.CANCELLED },
    );
    expect(stdout).toContain('Cancelled job');
  });

  it('does not claim a running job was cancelled — only that it was asked to stop', async () => {
    // The distinction the old boolean lost: a handler that ignores `job.signal` completes normally,
    // so "Cancelled" would have been a lie.
    const { stdout } = await runCommand(
      cancelCommand,
      { id: 'job-abcdef123456' },
      { cancelOutcome: CancelOutcome.SIGNALLED },
    );
    expect(stdout).toContain('asked to stop');
    expect(stdout).not.toContain('Cancelled job');
  });

  it('warns rather than failing when the job cannot be cancelled', async () => {
    // Already finished, or ACTIVE in another process: not an error, but the operator must not be
    // told it worked.
    const { stdout } = await runCommand(
      cancelCommand,
      { id: 'job-abcdef123456' },
      { cancelOutcome: CancelOutcome.NOT_CANCELLABLE },
    );
    expect(stdout).toContain('could not be cancelled');
  });

  it("surfaces core's error when the id matches nothing", async () => {
    // No pre-read any more: `cancelJob` itself throws, and the CLI just reports it.
    const { calls } = await runCommand(cancelCommand, { id: 'job-1' });
    expect(calls.cancelJob).toEqual([{ jobId: 'job-1' }]);
    await expect(
      runCommand(cancelCommand, { id: 'nope' }, { cancelOutcome: null }),
    ).rejects.toThrow(/does not exist/);
  });
});
