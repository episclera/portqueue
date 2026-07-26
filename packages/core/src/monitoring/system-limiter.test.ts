/**
 * `systemLimiter` behaviour: it is both the thresholds and the switch. Defining it makes every
 * worker on the client pause while a threshold is breached; omitting it means nothing throttles.
 * There is no per-worker opt-in to test, which is the point — the old `respectSystemPressure` flag
 * made it easy to configure thresholds that silently did nothing.
 *
 * The readings themselves are the machine's, not this process's — the assertions below compare them
 * against `os` directly, since a process-RSS share would pass a "> 0" check just as happily.
 */
import { freemem, totalmem } from 'node:os';
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

  it('records the machine’s health on the instance row even with no limiter configured', async () => {
    // Monitoring is unconditional: the heartbeat persists host CPU/memory so the dashboard and CLI
    // can show where each instance runs. Only the throttling is opt-in.
    h = await createTestQueue('sqlite', {
      instance: { instanceKey: 'w-health', heartbeatIntervalSeconds: 0.05 },
    });
    await waitFor(async () => {
      const row = await h.driver.getInstance({ instanceKey: 'w-health' });
      return row?.memoryPercent != null;
    });
    const row = await h.driver.getInstance({ instanceKey: 'w-health' });

    // Machine memory, within a few points of what `os` reports right now — this process's RSS is a
    // fraction of a percent of a developer machine, so the old per-process share would fail here.
    const machineMemoryPercent = ((totalmem() - freemem()) / totalmem()) * 100;
    expect(row!.memoryPercent).toBeCloseTo(machineMemoryPercent, 0);
    // Both are shares of the whole host, so neither can exceed 100 the way summed process CPU did.
    expect(row!.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(row!.cpuPercent).toBeLessThanOrEqual(100);
  });
});
