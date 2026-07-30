/** `portqueue jobs` (a page) and `portqueue job` (one row by id). */
import { jobCommand, jobsCommand } from './jobs';
import { makeFakePq, runCommand } from '../test-support/run-command';

describe('jobsCommand', () => {
  it('renders a job row and filters by status', async () => {
    const { stdout } = await runCommand(jobsCommand, { queue: 'emails', status: 'failed' });
    expect(stdout).toContain('job-abcdef12'); // truncated id
    expect(stdout).toContain('FAILED');
  });

  it('never declares a queue in this admin process', async () => {
    const { calls } = await runCommand(jobsCommand, { queue: 'emails' });
    expect(calls.createQueue).toEqual([]);
  });
});

describe('jobCommand', () => {
  it('prints the job detail', async () => {
    const { stdout } = await runCommand(jobCommand, { id: 'job-abcdef123456' });
    expect(stdout).toContain('Job job-abcdef123456');
  });

  it('throws when the job is not found', async () => {
    // A by-id read answers `null`, and the CLI has to turn that into an actionable message rather
    // than printing an empty detail view.
    const fake = makeFakePq({ job: null });
    await expect(jobCommand.run({ pq: fake.pq, flags: { id: 'missing' } })).rejects.toThrow(
      /not found/,
    );
  });
});
