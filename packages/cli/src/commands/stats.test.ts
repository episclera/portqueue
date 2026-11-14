/** `portqueue stats` — per-status counts, as a table or as raw JSON. */
import { statsCommand } from './stats';
import { makeFakePq, runCommand } from '../test-support/run-command';
import type { Teardown } from './types';

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

  describe('--watch', () => {
    const realSetInterval = globalThis.setInterval;
    const realClearInterval = globalThis.clearInterval;
    const realWrite = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);
    let ticks: (() => void)[];
    let cleared: unknown[];
    let out: string[];

    beforeEach(() => {
      ticks = [];
      cleared = [];
      out = [];
      // The interval is captured rather than run, so a test drives each refresh by hand and nothing
      // waits on the real 2 s cadence.
      globalThis.setInterval = ((fn: () => void) => {
        ticks.push(fn);
        return 'watch-timer' as unknown as NodeJS.Timeout;
      }) as typeof setInterval;
      globalThis.clearInterval = ((handle: unknown) => {
        cleared.push(handle);
      }) as typeof clearInterval;
      const sink = ((chunk: string | Uint8Array): boolean => {
        out.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      process.stdout.write = sink;
      process.stderr.write = sink;
    });

    afterEach(() => {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
      process.stdout.write = realWrite;
      process.stderr.write = realErr;
    });

    const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

    /** Start a watch (it never resolves by design) and return what it registered. */
    async function startWatch(pq = makeFakePq().pq): Promise<Teardown[]> {
      const teardowns: Teardown[] = [];
      void statsCommand.run({ pq, flags: { watch: true }, onExit: (fn) => teardowns.unshift(fn) });
      await flush();
      return teardowns;
    }

    it('hands its interval to the runner, so the watch can actually be stopped', async () => {
      const teardowns = await startWatch();
      expect(ticks).toHaveLength(1);
      expect(teardowns).toHaveLength(1);
      await teardowns[0]!();
      expect(cleared).toEqual(['watch-timer']);
    });

    it('reports a failed refresh and keeps watching instead of crashing the process', async () => {
      const { pq } = makeFakePq();
      let calls = 0;
      (pq as unknown as { getQueueStats: () => Promise<unknown> }).getQueueStats = async () => {
        calls += 1;
        if (calls > 1) throw new Error('connection reset');
        return { counts: { PENDING: 1 } };
      };
      await startWatch(pq);
      ticks[0]!();
      await flush();
      expect(out.join('')).toContain('Refresh failed: connection reset');
      // The next tick still runs: one bad read does not end the watch.
      ticks[0]!();
      await flush();
      expect(calls).toBe(3);
    });

    it('does not stack a refresh on one still in flight', async () => {
      const { pq } = makeFakePq();
      let calls = 0;
      let release: () => void = () => {};
      (pq as unknown as { getQueueStats: () => Promise<unknown> }).getQueueStats = () => {
        calls += 1;
        if (calls === 1) return Promise.resolve({ counts: {} });
        return new Promise((resolve) => {
          release = () => resolve({ counts: {} });
        });
      };
      await startWatch(pq);
      ticks[0]!();
      ticks[0]!();
      expect(calls).toBe(2);
      release();
      await flush();
      ticks[0]!();
      expect(calls).toBe(3);
    });
  });
});
