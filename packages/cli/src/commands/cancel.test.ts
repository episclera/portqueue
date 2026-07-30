/** `portqueue cancel` — stop a job without deleting its row. */
import { cancelCommand } from './cancel';
import { runCommand } from '../test-support/run-command';

describe('cancelCommand', () => {
  it('reports success when cancelled', async () => {
    const { stdout } = await runCommand(
      cancelCommand,
      { id: 'job-abcdef123456' },
      { cancelOk: true },
    );
    expect(stdout).toContain('Cancelled job');
  });

  it('warns rather than failing when the job cannot be cancelled', async () => {
    // Already finished, or already running past the point of a cooperative stop: not an error, but
    // the operator must not be told it worked.
    const { stdout } = await runCommand(
      cancelCommand,
      { id: 'job-abcdef123456' },
      { cancelOk: false },
    );
    expect(stdout).toContain('could not be cancelled');
  });

  it('throws when the id matches nothing', async () => {
    await expect(runCommand(cancelCommand, { id: 'nope' }, { job: null })).rejects.toThrow(
      /not found/,
    );
  });
});
