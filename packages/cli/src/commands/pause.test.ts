/** `portqueue pause` / `portqueue resume` — the persisted, cluster-wide queue flags. */
import { pauseCommand, resumeCommand } from './pause';
import { runCommand } from '../test-support/run-command';

describe('pauseCommand', () => {
  it('pauses a queue', async () => {
    const { stdout, calls } = await runCommand(pauseCommand, { queue: 'emails', mode: 'all' });
    expect(stdout).toContain("Paused 'emails'");
    expect(calls.pauseQueue).toHaveLength(1);
  });

  it('addresses the queue by name rather than declaring it', async () => {
    // Pausing used to go through `createQueue`, which re-declared the queue with no options and
    // silently wiped its registered defaults.
    const { calls } = await runCommand(pauseCommand, { queue: 'emails' });
    expect(calls.createQueue).toEqual([]);
  });
});

describe('resumeCommand', () => {
  it('resumes a queue', async () => {
    const { stdout, calls } = await runCommand(resumeCommand, { queue: 'emails' });
    expect(stdout).toContain("Resumed 'emails'");
    expect(calls.resumeQueue).toHaveLength(1);
  });
});
