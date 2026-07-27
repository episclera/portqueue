/**
 * `systemLimiter` behaviour: it is both the thresholds and the switch. Defining it makes every
 * worker on the client pause while a threshold is breached; omitting it means nothing throttles.
 * There is no per-worker opt-in to test, which is the point — the old `respectSystemPressure` flag
 * made it easy to configure thresholds that silently did nothing.
 *
 * The readings are this process's, not the machine's — the assertions below compare them against
 * `process`/`v8` directly, since a host-wide share would pass a "> 0" check just as happily (and on
 * a typical Linux or macOS box would sit above 90% the whole time).
 */
import { getHeapStatistics } from 'node:v8';
import { createTestQueue, waitFor, type TestQueueHandle } from '../test-utils/create-test-queue';

describe('systemLimiter', () => {
  let h: TestQueueHandle;
  afterEach(async () => {
    await h.cleanup();
  });

  it('stops every worker claiming while a threshold is breached', async () => {
    // A 0% heap-share threshold can never be satisfied, so pressure is permanently high.
    h = await createTestQueue('sqlite', {
      systemLimiter: { maxMemoryPercent: 0, sampleIntervalSeconds: 0.05 },
    });

    const ran: string[] = [];
    const queue = h.pq.createQueue('pressured');
    h.pq.createWorker({
      queue: 'pressured',
      limiter: { pollIntervalSeconds: 0.02 },
      handler: async (job) => void ran.push(job.id),
    });
    const added = await queue.addJob({ data: {} });
    await new Promise((r) => setTimeout(r, 200));

    // The worker polled several times over that window and claimed nothing, and the job is still
    // waiting rather than having been consumed and dropped.
    expect(ran).toHaveLength(0);
    expect((await queue.getJob({ jobId: added.jobId! }))?.status).toBe('PENDING');
  });

  it('claims normally when no systemLimiter is configured', async () => {
    h = await createTestQueue('sqlite');
    const ran: string[] = [];
    const queue = h.pq.createQueue('unpressured');
    h.pq.createWorker({
      queue: 'unpressured',
      limiter: { pollIntervalSeconds: 0.02 },
      handler: async (job) => void ran.push(job.id),
    });
    await queue.addJob({ data: {} });
    await waitFor(() => ran.length === 1);
  });

  it('records this process’s own health on the instance row even with no limiter configured', async () => {
    // Monitoring is unconditional: the heartbeat persists process CPU/heap so the dashboard and CLI
    // can show how each instance is doing. Only the throttling is opt-in.
    h = await createTestQueue('sqlite', {
      instance: { instanceKey: 'w-health', heartbeatIntervalSeconds: 0.05 },
    });
    await waitFor(async () => {
      const row = await h.driver.getInstance({ instanceKey: 'w-health' });
      return row?.memoryPercent != null;
    });
    const row = await h.driver.getInstance({ instanceKey: 'w-health' });

    // A share of V8's heap limit, within a couple of points of what this test process is holding
    // right now. A host-memory share would be far higher on a typical machine, and would not track
    // the heap at all.
    const heap = getHeapStatistics();
    const heapPercent = (heap.used_heap_size / heap.heap_size_limit) * 100;
    expect(row!.memoryPercent).toBeGreaterThan(0);
    expect(Math.abs(row!.memoryPercent! - heapPercent)).toBeLessThan(5);
    // Process CPU is a share of one core, so it stays well under 100 for a test that mostly waits —
    // but it is never negative, whatever the wall clock does between samples.
    expect(row!.cpuPercent).toBeGreaterThanOrEqual(0);
  });
});
