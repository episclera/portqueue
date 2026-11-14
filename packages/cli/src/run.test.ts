import { PortQueue } from '@portqueue/core';
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

  describe('shutdown', () => {
    const realShutdown = PortQueue.prototype.shutdown;
    const realExit = process.exit;
    let shutdowns: number;
    let exits: (number | string | null | undefined)[];

    beforeEach(() => {
      shutdowns = 0;
      exits = [];
      PortQueue.prototype.shutdown = async function (this: PortQueue, ...args) {
        shutdowns += 1;
        return realShutdown.apply(this, args);
      };
      process.exit = ((code?: number | string | null) => {
        exits.push(code);
      }) as typeof process.exit;
    });

    afterEach(() => {
      PortQueue.prototype.shutdown = realShutdown;
      process.exit = realExit;
    });

    const stopListeners = (): number =>
      process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');

    it('closes the client exactly once after a one-shot command', async () => {
      await captureOutput(async () => {
        expect(await run(['queues', '--json', '--driver', 'sqlite'])).toBe(0);
      });
      expect(shutdowns).toBe(1);
    });

    it('closes the client when a --watch command returns, instead of exiting with it connected', async () => {
      // `jobs` has nothing to watch, so it returns — and a command that returns is finished.
      const before = stopListeners();
      await captureOutput(async () => {
        expect(await run(['jobs', '--watch', '--json', '--driver', 'sqlite'])).toBe(0);
      });
      expect(shutdowns).toBe(1);
      // And the stop handlers it installed are gone, so nothing fires for a run that is over.
      expect(stopListeners()).toBe(before);
    });

    it('closes exactly once when a persistent command throws, and leaves no signal handler', async () => {
      const saved = [process.env.PORTQUEUE_ROOT_USER, process.env.PORTQUEUE_ROOT_PASSWORD];
      delete process.env.PORTQUEUE_ROOT_USER;
      delete process.env.PORTQUEUE_ROOT_PASSWORD;
      const before = stopListeners();
      try {
        const { stderr } = await captureOutput(async () => {
          // `dashboard` is persistent, and without credentials it throws during startup.
          expect(await run(['dashboard', '--driver', 'sqlite'])).toBe(1);
        });
        expect(stderr).toContain('requires credentials');
      } finally {
        if (saved[0] !== undefined) process.env.PORTQUEUE_ROOT_USER = saved[0];
        if (saved[1] !== undefined) process.env.PORTQUEUE_ROOT_PASSWORD = saved[1];
      }
      expect(shutdowns).toBe(1);
      expect(stopListeners()).toBe(before);
    });

    it('drains a persistent command once on a stop signal, then exits 130', async () => {
      const before = new Set(process.listeners('SIGINT'));
      await captureOutput(async () => {
        void run(['listen', '--json', '--driver', 'sqlite']);
        // Wait for the runner to install its handler (after the client has been built).
        for (let i = 0; i < 200 && process.listeners('SIGINT').length === before.size; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const handler = process.listeners('SIGINT').find((l) => !before.has(l));
        expect(handler).toBeDefined();
        // Called directly rather than via `process.emit`, which would also reach Jest's own handler.
        process.removeListener('SIGINT', handler as () => void);
        (handler as () => void)();
        for (let i = 0; i < 200 && exits.length === 0; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      });
      expect(exits).toEqual([130]);
      expect(shutdowns).toBe(1);
      // The run never returns (it is held open by design), so drop the SIGTERM handler it left.
      for (const l of process.listeners('SIGTERM')) {
        if (!before.has(l)) process.removeListener('SIGTERM', l);
      }
    });
  });
});
