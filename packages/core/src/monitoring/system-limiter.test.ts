/**
 * `systemLimiter` behaviour: it is both the thresholds and the switch. Defining it makes every
 * worker on the client pause while a threshold is breached; omitting it means nothing throttles.
 * There is no per-worker opt-in to test, which is the point — the old `respectSystemPressure` flag
 * made it easy to configure thresholds that silently did nothing.
 */
import { createTestQueue, waitFor, type TestQueueHandle } from '../test-utils/create-test-queue';

describe('systemLimiter', () => {
  let h: TestQueueHandle;
  afterEach(async () => {
    await h.cleanup();
  });

  it('stops every worker claiming while a threshold is breached', async () => {
    // A 0% memory-share threshold can never be satisfied, so pressure is permanently high.
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

  it('records this process’s health on the instance row even with no limiter configured', async () => {
    // Monitoring is unconditional: the heartbeat persists CPU/memory/RSS so the dashboard and CLI
    // can show per-instance health. Only the throttling is opt-in.
    h = await createTestQueue('sqlite', {
      instance: { instanceKey: 'w-health', heartbeatIntervalSeconds: 0.05 },
    });
    await waitFor(async () => {
      const row = await h.driver.getInstance({ instanceKey: 'w-health' });
      return row?.rssBytes != null;
    });
    const row = await h.driver.getInstance({ instanceKey: 'w-health' });
    expect(typeof row!.cpuPercent).toBe('number');
    expect(typeof row!.memoryPercent).toBe('number');
    expect(row!.rssBytes).toBeGreaterThan(1_000_000);
  });
});
