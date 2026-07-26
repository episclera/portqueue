import { run } from './run';
import { setColorEnabled } from './output';
import { captureOutput } from './test-support/capture';

beforeEach(() => setColorEnabled(false));

describe('run', () => {
  it('prints help and exits 0 for `help`, no args, and --help', async () => {
    for (const argv of [['help'], [], ['--help']]) {
      const { stdout } = await captureOutput(async () => {
        expect(await run(argv)).toBe(0);
      });
      expect(stdout).toContain('portqueue —');
    }
  });

  it('exits 1 and reports an unknown command', async () => {
    const { stderr } = await captureOutput(async () => {
      expect(await run(['bogus'])).toBe(1);
    });
    expect(stderr).toContain("Unknown command 'bogus'");
  });

  it('builds its own in-memory sqlite instance, dispatches, and exits 0', async () => {
    const { stdout } = await captureOutput(async () => {
      expect(await run(['queues', '--json', '--driver', 'sqlite'])).toBe(0);
    });
    // A fresh in-memory DB has no queues yet — the command still succeeds with an empty JSON list.
    expect(stdout).toContain('[]');
  });

  it('exits 1 when a command throws a CliError', async () => {
    const { stderr } = await captureOutput(async () => {
      // `remove` with neither selector throws a CliError after the instance is built.
      expect(await run(['remove', '--driver', 'sqlite'])).toBe(1);
    });
    expect(stderr).toContain('exactly one');
  });

  it('lists every queue’s schedules when --queue is omitted', async () => {
    const { stdout } = await captureOutput(async () => {
      expect(await run(['schedules', '--json', '--driver', 'sqlite'])).toBe(0);
    });
    // Reading across queues no longer needs --queue, and a fresh DB simply has none.
    expect(stdout).toContain('[]');
  });
});
