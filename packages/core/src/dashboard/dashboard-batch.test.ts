/**
 * `pq._dashboard.runJobBatch` on a real engine — the dashboard's retry / cancel / remove buttons.
 *
 * Each action is now **one statement** over the whole id set, which is what these tests pin: a
 * single stale or ACTIVE id must not fail the rest of the batch, and the connection must still be
 * usable afterwards. The previous implementation looped a per-id `requeueJob` inside one
 * transaction, where a read issued outside that transaction wedged a single-connection engine
 * (both test engines) and a missing id rolled back every retry beside it.
 *
 * Both engines are covered because how a driver serialises access is its own business.
 */
import {
  createTestQueue,
  TEST_ENGINES,
  type TestQueueHandle,
} from '../test-utils/create-test-queue';
import { JobStatus } from '../jobs/job-state.enum';
import { PortQueueEvent } from '../events/event-name.enum';
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
    const added = await h.pq.addJobs({
      queue,
      jobs: Array.from({ length: count }, (_, i) => ({ data: { i } })),
    });
    return added.map((r) => r.jobId!);
  }

  it('retries a batch, and keeps answering afterwards', async () => {
    const ids = await seed('batched', 3);

    const result = await h.pq._dashboard.runJobBatch({
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
    let attempts = 0;
    h.pq.createQueue<{ v: number }>({
      name: 'batched',
      limiter: { pollIntervalSeconds: 0.02 },
      handler: async () => {
        attempts += 1;
        throw new Error('nope');
      },
    });
    const jobId = (
      await h.pq.addJob({
        queue: 'batched',
        data: { v: 1 },
        retry: { maxAttempts: 1, delaySeconds: 0 },
      })
    ).jobId!;
    await waitForStatus(h, jobId, JobStatus.FAILED);

    await h.pq._dashboard.runJobBatch({
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

  it('removes a batch in one statement', async () => {
    const ids = await seed('batched', 3);
    const result = await h.pq._dashboard.runJobBatch({
      jobIds: ids,
      action: JobBatchAction.REMOVE,
    });
    expect(result).toEqual({ affected: 3, requested: 3 });
    expect((await h.pq._dashboard.getJobs({ queue: 'batched' })).items).toHaveLength(0);
  });

  it('cancels a batch of pending jobs', async () => {
    const ids = await seed('batched', 2);
    const result = await h.pq._dashboard.runJobBatch({
      jobIds: ids,
      action: JobBatchAction.CANCEL,
    });
    expect(result).toEqual({ affected: 2, requested: 2 });
    const page = await h.pq._dashboard.getJobs({ queue: 'batched' });
    expect(page.items.every((j) => j.status === JobStatus.CANCELLED)).toBe(true);
  });

  it('does not let one stale id fail the rest of a retry batch', async () => {
    // The old per-id loop threw `DriverQueryError` on a missing id and rolled back the whole
    // transaction, so one already-removed job undid every other retry in the batch.
    const ids = await seed('batched', 3);
    const result = await h.pq._dashboard.runJobBatch({
      jobIds: [...ids, 'no-such-job'],
      action: JobBatchAction.RETRY,
    });
    expect(result).toEqual({ affected: 3, requested: 4 });
    const page = await h.pq._dashboard.getJobs({ queue: 'batched' });
    expect(page.items.every((j) => j.status === JobStatus.PENDING)).toBe(true);
  });

  it('leaves an ACTIVE job out of a retry or remove batch', async () => {
    const ids = await seed('batched', 2);
    // Claim one so it is ACTIVE, exactly as a running worker would hold it.
    await h.driver.claimJobs({
      queueName: 'batched',
      limit: 1,
      lockDurationSeconds: 60,
      now: h.clock.now(),
    });
    const active = (await h.pq.getJobs({ queue: 'batched', statuses: [JobStatus.ACTIVE] }))
      .items[0]!;
    const idle = ids.find((id) => id !== active.id)!;

    const retried = await h.pq._dashboard.runJobBatch({
      jobIds: ids,
      action: JobBatchAction.RETRY,
    });
    expect(retried).toEqual({ affected: 1, requested: 2 });
    expect((await h.pq.getJob({ jobId: active.id }))!.status).toBe(JobStatus.ACTIVE);

    const removed = await h.pq._dashboard.runJobBatch({
      jobIds: ids,
      action: JobBatchAction.REMOVE,
    });
    expect(removed).toEqual({ affected: 1, requested: 2 });
    expect(await h.pq.getJob({ jobId: idle })).toBeNull();
    expect(await h.pq.getJob({ jobId: active.id })).not.toBeNull();
  });

  it('removes many schedules in one call, reporting each one’s queue', async () => {
    const a = await h.pq.addJob({
      queue: 'sched-batch',
      data: {},
      schedule: { cron: '0 1 * * *' },
    });
    const b = await h.pq.addJob({
      queue: 'sched-batch',
      data: {},
      schedule: { cron: '0 2 * * *' },
    });
    const removedQueues: string[] = [];
    h.pq.on(PortQueueEvent.SCHEDULE_REMOVED, (p) => removedQueues.push(p.queue));

    const result = await h.pq._dashboard.removeSchedules({
      scheduleIds: [a.scheduleId!, b.scheduleId!, 'missing'],
    });
    expect(result).toEqual({ affected: 2, requested: 3 });
    expect(removedQueues).toEqual(['sched-batch', 'sched-batch']);
    expect((await h.pq.getSchedules({ queue: 'sched-batch' })).total).toBe(0);
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
