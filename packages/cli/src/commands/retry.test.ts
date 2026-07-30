/** `portqueue retry` — re-arm a settled job so it runs again. */
import { retryCommand } from './retry';
import { runCommand } from '../test-support/run-command';

describe('retryCommand', () => {
  it('requeues an existing job', async () => {
    const { stdout, calls } = await runCommand(retryCommand, { id: 'job-abcdef123456' });
    // The same row is re-armed, so there is one id to report, not an old one and a new one.
    expect(stdout).toContain('Requeued job job-abcdef123456 on queue emails');
    expect(calls.retryJob).toEqual([{ jobId: 'job-abcdef123456' }]);
  });

  it('explains the refusal when the job is still running', async () => {
    // Core refuses to re-arm an ACTIVE row — clearing its lock would let a second worker claim it —
    // and answers `null`. The CLI has to turn that into something actionable, not "undefined".
    await expect(
      runCommand(retryCommand, { id: 'job-abcdef123456' }, { retryResult: null }),
    ).rejects.toThrow(/cannot be requeued/);
  });

  it('throws when the id matches nothing', async () => {
    await expect(runCommand(retryCommand, { id: 'nope' }, { job: null })).rejects.toThrow(
      /not found/,
    );
  });
});
