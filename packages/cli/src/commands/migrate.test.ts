/** `portqueue migrate` — the one command that deliberately changes a schema. */
import { migrateCommand } from './migrate';
import { runCommand } from '../test-support/run-command';

describe('migrateCommand', () => {
  it('runs migrations', async () => {
    const { stdout, calls } = await runCommand(migrateCommand);
    expect(stdout).toContain('Migrations applied');
    expect(calls.migrated).toBe(true);
  });
});
