import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './run.js';
import { setColorEnabled } from './output.js';
import { captureOutput } from './test-support/capture.js';

beforeEach(() => setColorEnabled(false));

/** A self-contained config module exporting a minimal fake PortQueue. */
function writeFakeConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pq-run-'));
  const path = join(dir, 'portqueue.config.mjs');
  writeFileSync(
    path,
    `export default {
       isRunning: false,
       async init() { this.isRunning = true; },
       async shutdown() {},
       async getQueues() {
         return [{ name: 'emails', counts: { PENDING: 0, ACTIVE: 0, COMPLETED: 0, FAILED: 0 },
           acceptingPaused: false, processingPaused: false }];
       },
     };`,
  );
  return path;
}

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

  it('loads the config, dispatches the command, and exits 0', async () => {
    const path = writeFakeConfig();
    const { stdout } = await captureOutput(async () => {
      expect(await run(['queues', '--json', '--config', path])).toBe(0);
    });
    expect(stdout).toContain('"name": "emails"');
  });

  it('exits 1 when a command throws a CliError', async () => {
    const path = writeFakeConfig();
    const { stderr } = await captureOutput(async () => {
      // `schedules` without --queue throws a CliError after the instance loads.
      expect(await run(['schedules', '--config', path])).toBe(1);
    });
    expect(stderr).toContain('requires --queue');
  });
});
