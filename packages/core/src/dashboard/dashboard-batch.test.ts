/**
 * `pq._dashboard.runJobBatch` on a real engine — the dashboard's retry / cancel / remove buttons.
 *
 * The retry case is the reason this suite exists. Every batch runs inside one transaction, and the
 * driver's `requeueJob` reads the row before re-arming it. That read used to be issued *outside*
 * the transaction, which on a single-connection engine (both test engines, and PGLite is what the
 * examples run) queues behind the very transaction that is waiting for it: the request never
 * answers, and because the connection stays wedged, no later request answers either. A regression
 * here shows up as a timed-out test rather than a wrong assertion.
 *
 * Both engines are covered because the deadlock is a property of how the driver serialises access,
 * which each driver owns for itself.
 */
import {
  createTestQueue,
  TEST_ENGINES,
  type TestQueueHandle,
} from '../test-utils/create-test-queue';
import { JobStatus } from '../jobs/job-state.enum';
import { JobBatchAction } from './dashboard-results';

describe.each(TEST_ENGINES)('dashboard job batch (%s)', (engine) => {
  let h: TestQueueHandle;
  beforeEach(async () => {
    h = await createTestQueue(engine);
  });
  afterEach(async () => {
    await h.cleanup();
  });

  /** `count` pending jobs on one queue, returning their ids. */
  async function seed(queue: string, count: number): Promise<string[]> {
    const q = h.pq.createQueue(queue);
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) ids.push((await q.addJob({ data: { i } })).jobId!);
    return ids;
  }

  it('retries a batch, and keeps answering afterwards', async () => {
    const ids = await seed('batched', 3);

    const result = await h.pq._dashboard.runJobBatch({
      queue: 'batched',
      jobIds: ids,
      action: JobBatchAction.RETRY,
    });

    expect(result).toEqual({ affected: 3, requested: 3 });
    // The connection is still usable — the read below is what used to hang forever.
    const page = await h.pq._dashboard.getJobs({ queue: 'batched' });
    expect(page.items).toHaveLength(3);
    expect(page.items.every((j) => j.status === JobStatus.PENDING)).toBe(true);
  });

  it('re-arms a failed job rather than adding a new one', async () => {
    const q = h.pq.createQueue<{ v: number }>('batched');
    let attempts = 0;
    h.pq.createWorker({
      queue: 'batched',
      limiter: { pollIntervalSeconds: 0.02 },
      handler: async () => {
        attempts += 1;
        throw new Error('nope');
      },
    });
    const jobId = (await q.addJob({ data: { v: 1 }, retry: { maxAttempts: 1, delaySeconds: 0 } }))
      .jobId!;
    await waitForStatus(h, jobId, JobStatus.FAILED);

    await h.pq._dashboard.runJobBatch({
      queue: 'batched',
      jobIds: [jobId],
      action: JobBatchAction.RETRY,
    });

    // Same row, counters cleared — and it is picked up again.
    const job = await h.pq.getJob({ jobId });
    expect(job?.id).toBe(jobId);
    expect(job?.retryAttempt).toBe(0);
    expect(job?.failureMessage).toBeNull();
    await waitForStatus(h, jobId, JobStatus.FAILED);
    expect(attempts).toBeGreaterThan(1);
  });

  it('removes a batch in one transaction', async () => {
    const ids = await seed('batched', 3);
    const result = await h.pq._dashboard.runJobBatch({
      queue: 'batched',
      jobIds: ids,
      action: JobBatchAction.REMOVE,
    });
    expect(result).toEqual({ affected: 3, requested: 3 });
    expect((await h.pq._dashboard.getJobs({ queue: 'batched' })).items).toHaveLength(0);
  });

  it('cancels a batch of pending jobs', async () => {
    const ids = await seed('batched', 2);
    const result = await h.pq._dashboard.runJobBatch({
      queue: 'batched',
      jobIds: ids,
      action: JobBatchAction.CANCEL,
    });
    expect(result).toEqual({ affected: 2, requested: 2 });
    const page = await h.pq._dashboard.getJobs({ queue: 'batched' });
    expect(page.items.every((j) => j.status === JobStatus.CANCELLED)).toBe(true);
  });
});

/** Poll until a job reaches `status` (worker-driven, so there is nothing to await directly). */
async function waitForStatus(
  h: TestQueueHandle,
  jobId: string,
  status: JobStatus,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await h.pq.getJob({ jobId }))?.status === status) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`job never reached ${status}`);
}
