import { createTestQueue, waitFor, type TestQueueHandle } from '../test-utils/create-test-queue.js';
import { JobStatus } from '../jobs/job-state.enum.js';
import { PauseMode, RetryMode } from '../options/enums.js';

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

  it('pauses and resumes via the client convenience methods', async () => {
    h.pq.createQueue('cq');
    await h.pq.pauseQueue({ queue: 'cq', mode: PauseMode.ALL });
    await expect(h.pq.createQueue('cq').addJob({ data: {} })).rejects.toThrow(/refusing new jobs/);
    await h.pq.resumeQueue({ queue: 'cq' });
    const res = await h.pq.createQueue('cq').addJob({ data: {} });
    expect(res.jobId).toBeTruthy();
  });

  it('requeues a finished single-function job FROM_START as a fresh run', async () => {
    const q = h.pq.createQueue('re');
    h.pq.createWorker({ queue: 're', pollIntervalMs: 20, handler: async () => 'ok' });
    const res = await q.addJob({ data: { v: 1 } });
    await waitFor(
      async () => (await q.getJob({ jobId: res.jobId! }))?.status === JobStatus.COMPLETED,
    );
    const requeued = await q.retryJob({ jobId: res.jobId!, from: RetryMode.FROM_START });
    expect(requeued.jobId).toBeTruthy();
    expect(requeued.jobId).not.toBe(res.jobId);
  });

  it('returns null for an unknown job / workflow', async () => {
    expect(await h.pq.getJob({ jobId: 'nope' })).toBeNull();
    expect(await h.pq.getWorkflow({ workflowId: 'nope' })).toBeNull();
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
});
