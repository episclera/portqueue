/**
 * The consumer's shutdown path, on a real engine.
 *
 * Two behaviours are pinned here, and both were bugs. A handler that observes `job.signal` settles
 * its **own** row — its lock is not released underneath it, which is what used to let another
 * instance reclaim a job that was about to complete and run it twice. A handler that ignores the
 * signal does have its lock cut short, so the job is reclaimable at once instead of waiting out a
 * long visibility window in a process that has already gone.
 *
 * Asserted on the events emitted and the driver calls made, rather than by reading rows afterwards:
 * `shutdown()` disconnects the driver, so "after the shutdown" is past the point where a query can
 * be issued at all.
 */
import { PortQueueEvent } from '../events/event-name.enum';
import {
  createTestQueue,
  TEST_ENGINES,
  waitFor,
  type TestQueueHandle,
} from '../test-utils/create-test-queue';

/** Record every `extendLock` the driver is asked for, keeping the real behaviour underneath. */
function spyExtendLock(h: TestQueueHandle): Array<{ jobId: string; lockDurationSeconds: number }> {
  const calls: Array<{ jobId: string; lockDurationSeconds: number }> = [];
  const original = h.driver.extendLock.bind(h.driver);
  h.driver.extendLock = async (options) => {
    calls.push({ jobId: options.jobId, lockDurationSeconds: options.lockDurationSeconds });
    return original(options);
  };
  return calls;
}

/** The releases among those calls — a release is an extension to a deadline in the past. */
const releases = (
  calls: Array<{ jobId: string; lockDurationSeconds: number }>,
  jobId: string,
): number => calls.filter((c) => c.jobId === jobId && c.lockDurationSeconds < 0).length;

for (const engine of TEST_ENGINES) {
  describe(`worker shutdown (${engine})`, () => {
    let h: TestQueueHandle;

    beforeEach(async () => {
      h = await createTestQueue(engine);
    });
    afterEach(async () => {
      await h.cleanup();
    });

    it('lets a handler that observes the signal settle its own row, releasing nothing', async () => {
      let started = false;
      const completed: string[] = [];
      h.pq.on(PortQueueEvent.JOB_COMPLETED, ({ jobId }) => void completed.push(jobId));
      h.pq.createQueue({
        name: 'cooperative',
        limiter: { pollIntervalSeconds: 0.02 },
        handler: async (job) => {
          started = true;
          await new Promise<void>((resolve) => {
            if (job.signal.aborted) return resolve();
            job.signal.addEventListener('abort', () => resolve());
          });
        },
      });
      const { jobId } = await h.pq.addJob({ queue: 'cooperative', data: {} });
      await waitFor(() => started);
      const calls = spyExtendLock(h);

      // Drain window of zero: the abort fires straight away, and the handler settles just after it.
      await h.pq.shutdown({ graceful: true, timeoutSeconds: 0 });

      expect(completed).toContain(jobId);
      // Nothing released its lock — the completion is this run's own, so there was no claim to cut.
      expect(releases(calls, jobId!)).toBe(0);
    });

    it('releases the claim of a handler that ignores the signal, so the job can be reclaimed', async () => {
      let started = false;
      let release: (() => void) | undefined;
      h.pq.createQueue({
        name: 'stubborn',
        // A long visibility window, so a job left holding it would be stuck for five minutes.
        limiter: { pollIntervalSeconds: 0.02, lockDurationSeconds: 300 },
        handler: async () => {
          started = true;
          // Deliberately ignores `job.signal` — the common shape for short work.
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      });
      const { jobId } = await h.pq.addJob({ queue: 'stubborn', data: {} });
      await waitFor(() => started);
      const calls = spyExtendLock(h);

      await h.pq.shutdown({ graceful: true, timeoutSeconds: 0 });

      expect(releases(calls, jobId!)).toBe(1);
      release?.();
    });

    it('drains a handler that finishes inside the window without aborting it', async () => {
      let aborted = false;
      let started = false;
      let done = false;
      const completed: string[] = [];
      h.pq.on(PortQueueEvent.JOB_COMPLETED, ({ jobId }) => void completed.push(jobId));
      h.pq.createQueue({
        name: 'quick',
        limiter: { pollIntervalSeconds: 0.02 },
        handler: async (job) => {
          started = true;
          job.signal.addEventListener('abort', () => {
            aborted = true;
          });
          await new Promise((resolve) => setTimeout(resolve, 20));
          done = true;
        },
      });
      const { jobId } = await h.pq.addJob({ queue: 'quick', data: {} });
      await waitFor(() => started); // in flight, and with work left to do
      const calls = spyExtendLock(h);

      await h.pq.shutdown({ graceful: true, timeoutSeconds: 5 });

      expect(done).toBe(true);
      expect(aborted).toBe(false); // it finished on its own; nothing had to be cancelled
      expect(completed).toContain(jobId);
      expect(releases(calls, jobId!)).toBe(0);
    });
  });
}
