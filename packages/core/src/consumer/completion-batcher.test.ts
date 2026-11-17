import { CompletionBatcher } from './completion-batcher';
import type { CompletedJobInput, Driver } from '../drivers/driver.interface';
import type { Clock } from '../util/clock';

const clock = { now: () => 1_000 } as unknown as Clock;

/** A driver stub that records every `completeJobs` call and settles what `settle` allows. */
function fakeDriver(options: { settle?: (job: CompletedJobInput) => boolean; batched?: boolean }) {
  const calls: CompletedJobInput[][] = [];
  const singles: string[] = [];
  let release: (() => void) | null = null;
  const driver = {
    completeJob: async (o: { jobId: string }) => {
      singles.push(o.jobId);
      return true;
    },
    ...(options.batched === false
      ? {}
      : {
          completeJobs: async (o: { jobs: CompletedJobInput[] }) => {
            calls.push(o.jobs);
            // Hold the first flush open so the test can add completions while it is in flight.
            if (calls.length === 1 && release === null) {
              await new Promise<void>((resolve) => (release = resolve));
            }
            return o.jobs
              .filter((job) => (options.settle ?? (() => true))(job))
              .map((j) => j.jobId);
          },
        }),
  } as unknown as Driver;
  return { driver, calls, singles, releaseFirst: () => release?.() };
}

describe('CompletionBatcher', () => {
  it('settles every completion issued in one tick with a single driver call', async () => {
    const { driver, calls, releaseFirst } = fakeDriver({});
    const batcher = new CompletionBatcher(driver, clock);
    const pending = ['a', 'b', 'c'].map((jobId) => batcher.complete({ jobId, lockToken: 't' }));
    await new Promise((r) => setImmediate(r));
    releaseFirst();
    expect(await Promise.all(pending)).toEqual([true, true, true]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.map((j) => j.jobId)).toEqual(['a', 'b', 'c']);
  });

  it('carries completions that arrive mid-flush into the next batch (group commit)', async () => {
    const { driver, calls, releaseFirst } = fakeDriver({});
    const batcher = new CompletionBatcher(driver, clock);
    const first = batcher.complete({ jobId: 'a', lockToken: 't' });
    await new Promise((r) => setImmediate(r)); // first flush is now in flight and held open
    const later = [
      batcher.complete({ jobId: 'b', lockToken: 't' }),
      batcher.complete({ jobId: 'c', lockToken: 't' }),
    ];
    releaseFirst();
    expect(await Promise.all([first, ...later])).toEqual([true, true, true]);
    expect(calls.map((batch) => batch.map((j) => j.jobId))).toEqual([['a'], ['b', 'c']]);
  });

  it('reports a lost claim as not settled without affecting the rest of the batch', async () => {
    const { driver, releaseFirst } = fakeDriver({ settle: (job) => job.lockToken !== 'stale' });
    const batcher = new CompletionBatcher(driver, clock);
    const ok = batcher.complete({ jobId: 'a', lockToken: 'live' });
    const lost = batcher.complete({ jobId: 'b', lockToken: 'stale' });
    await new Promise((r) => setImmediate(r));
    releaseFirst();
    expect(await ok).toBe(true);
    expect(await lost).toBe(false);
  });

  it('rejects every waiter in a batch whose driver call failed', async () => {
    const driver = {
      completeJob: async () => true,
      completeJobs: async () => {
        throw new Error('db down');
      },
    } as unknown as Driver;
    const batcher = new CompletionBatcher(driver, clock);
    const a = batcher.complete({ jobId: 'a' });
    const b = batcher.complete({ jobId: 'b' });
    await expect(a).rejects.toThrow('db down');
    await expect(b).rejects.toThrow('db down');
  });

  it('falls back to the singular completeJob for a driver without completeJobs', async () => {
    const { driver, singles } = fakeDriver({ batched: false });
    const batcher = new CompletionBatcher(driver, clock);
    expect(await batcher.complete({ jobId: 'a', lockToken: 't' })).toBe(true);
    expect(singles).toEqual(['a']);
  });
});
