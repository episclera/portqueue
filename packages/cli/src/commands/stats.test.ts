/** `portqueue stats` — per-status counts, as a table or as raw JSON. */
import { statsCommand } from './stats';
import { runCommand } from '../test-support/run-command';

describe('statsCommand', () => {
  it('prints a table of counts by state', async () => {
    const { stdout } = await runCommand(statsCommand);
    expect(stdout).toContain('Stats');
    expect(stdout).toContain('PENDING');
    expect(stdout).toContain('2');
  });

  it('prints raw JSON with --json', async () => {
    // Every read command offers --json so the CLI can be piped into jq rather than parsed as a table.
    const { stdout } = await runCommand(statsCommand, { json: true });
    expect(stdout).toContain('"PENDING": 2');
  });
});
