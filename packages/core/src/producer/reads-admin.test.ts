import { createTestQueue, waitFor, type TestQueueHandle } from '../test-utils/create-test-queue';
import { JobStatus } from '../jobs/job-state.enum';
import { PauseMode } from '../options/enums';

// Single-engine (sqlite) coverage of client-wide reads + admin paths.
describe('client reads & admin (sqlite)', () => {
  let h: TestQueueHandle;
  beforeEach(async () => {
    h = await createTestQueue('sqlite');
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('reports client-wide stats and queue listing', async () => {
    const a = h.pq.createQueue('a');
    const b = h.pq.createQueue('b');
    await a.addJob({ data: {} });
    await b.addJob({ data: {} });
    const queues = await h.pq.getQueues();
    expect(queues.map((q) => q.name).sort()).toEqual(['a', 'b']);
    const stats = await h.pq.getStats();
    expect(stats.counts.PENDING).toBe(2);
    const scoped = await h.pq.getQueueStats({ queue: 'a' });
    expect(scoped.queue).toBe('a');
    expect(scoped.counts.PENDING).toBe(1);
  });

  it('pages jobs with a cursor', async () => {
    const q = h.pq.createQueue('paged');
    for (let i = 0; i < 5; i += 1) await q.addJob({ data: { i } });
    const page1 = await h.pq.getJobs({ queue: 'paged', limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    const page2 = await h.pq.getJobs({ queue: 'paged', limit: 2, cursor: page1.cursor! });
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);
  });

  it('pages jobs by offset and reports the filter total on every page', async () => {
    const q = h.pq.createQueue('offset-paged');
    for (let i = 0; i < 5; i += 1) await q.addJob({ data: { i } });

    const page1 = await h.pq.getJobs({ queue: 'offset-paged', limit: 2, offset: 0 });
    const page3 = await h.pq.getJobs({ queue: 'offset-paged', limit: 2, offset: 4 });

    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.hasMore).toBe(true);

    // The last page is short, has nothing after it, and shares no row with the first.
    expect(page3.items).toHaveLength(1);
    expect(page3.total).toBe(5);
    expect(page3.hasMore).toBe(false);
    const firstIds = page1.items.map((j) => j.id);
    expect(page3.items.every((j) => !firstIds.includes(j.id))).toBe(true);
  });

  it('counts only the filtered rows in total', async () => {
    const q = h.pq.createQueue('counted');
    for (let i = 0; i < 3; i += 1) await q.addJob({ data: { i } });
    await h.pq.createQueue('other').addJob({ data: {} });

    const scoped = await h.pq.getJobs({ queue: 'counted', limit: 1 });
    expect(scoped.total).toBe(3);

    const byStatus = await h.pq.getJobs({
      queue: 'counted',
      statuses: [JobStatus.COMPLETED],
      limit: 1,
    });
    expect(byStatus.total).toBe(0);
    expect(byStatus.items).toHaveLength(0);
  });

  it('pauses and resumes via the client convenience methods', async () => {
    h.pq.createQueue('cq');
    await h.pq.pauseQueue({ queue: 'cq', mode: PauseMode.ALL });
    await expect(h.pq.createQueue('cq').addJob({ data: {} })).rejects.toThrow(/refusing new jobs/);
    await h.pq.resumeQueue({ queue: 'cq' });
    const res = await h.pq.createQueue('cq').addJob({ data: {} });
    expect(res.jobId).toBeTruthy();
  });

  it('re-runs a finished single-function job by re-arming its own row', async () => {
    const q = h.pq.createQueue('re');
    h.pq.createWorker({ queue: 're', limiter: { pollIntervalMs: 20 }, handler: async () => 'ok' });
    const res = await q.addJob({ data: { v: 1 } });
    await waitFor(
      async () => (await q.getJob({ jobId: res.jobId! }))?.status === JobStatus.COMPLETED,
    );
    const requeued = await q.retryJob({ jobId: res.jobId! });
    expect(requeued.jobId).toBe(res.jobId); // same row, re-armed (not a fresh job)
    expect(requeued.status).toBe(JobStatus.PENDING);
    // and it runs again to completion
    await waitFor(
      async () => (await q.getJob({ jobId: res.jobId! }))?.status === JobStatus.COMPLETED,
    );
  });

  it('returns null for an unknown job', async () => {
    expect(await h.pq.getJob({ jobId: 'nope' })).toBeNull();
  });

  it('bulk-removes jobs by id and reports throughput after completion', async () => {
    const q = h.pq.createQueue('bulk');
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await q.addJob({ data: { i } })).jobId!);
    const removed = await q.removeJobs({ jobIds: ids });
    expect(removed).toBe(3);
    const stats = await q.getQueueStats();
    expect(stats.throughputPerMinute).toBeGreaterThanOrEqual(0);
  });

  it('never removes an ACTIVE job — it must be cancelled first', async () => {
    const q = h.pq.createQueue('rm-active');
    const jobId = (await q.addJob({ data: {} })).jobId!;
    // Claim it so the row is ACTIVE, exactly as a worker would hold it.
    await h.driver.claimJobs({
      queueName: 'rm-active',
      limit: 1,
      lockDurationMs: 30_000,
      now: h.clock.now(),
    });
    expect((await q.getJob({ jobId }))!.status).toBe(JobStatus.ACTIVE);

    // removeJob skips the running row and reports it didn't act.
    expect(await q.removeJob({ jobId })).toBe(false);
    // removeJobs by id leaves the active job out of the deleted count.
    expect(await q.removeJobs({ jobIds: [jobId] })).toBe(0);
    // removeJobs by ACTIVE status is rejected outright.
    await expect(q.removeJobs({ statuses: [JobStatus.ACTIVE] })).rejects.toThrow(/ACTIVE/);
    // The job is still there, untouched.
    expect((await q.getJob({ jobId }))!.status).toBe(JobStatus.ACTIVE);
  });

  it('removes only a long-inactive instance', async () => {
    await h.driver.upsertInstance({ instanceKey: 'w1', now: h.clock.now() });
    // Freshly seen → refused.
    await expect(h.pq.removeInstance({ instanceKey: 'w1' })).rejects.toThrow(/still active/);
    // Past the 30-minute window → allowed, and the row is gone.
    h.clock.advance(31 * 60_000);
    expect(await h.pq.removeInstance({ instanceKey: 'w1' })).toBe(true);
    expect(await h.driver.getInstance({ instanceKey: 'w1' })).toBeNull();
    // Unknown instance → false (nothing to remove).
    expect(await h.pq.removeInstance({ instanceKey: 'ghost' })).toBe(false);
  });

  it('removes a queue only when it is not registered in this process', async () => {
    // A queue row that exists in the DB but was never declared on this client (e.g. left by a
    // process that has since stopped) can be removed.
    await h.driver.ensureQueue({ name: 'orphan', now: h.clock.now() });
    expect(await h.pq.removeQueue({ name: 'orphan' })).toBe(true);
    expect(await h.driver.getQueueByName({ name: 'orphan' })).toBeNull();

    // A queue still declared on this client is refused.
    h.pq.createQueue('live');
    await expect(h.pq.removeQueue({ name: 'live' })).rejects.toThrow(/still registered/);
  });
});
