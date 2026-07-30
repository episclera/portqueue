import {
  createTestQueue,
  TEST_ENGINES,
  waitFor,
  type TestQueueHandle,
} from '../test-utils/create-test-queue';
import { JobStatus } from '../jobs/job-state.enum';
import { PortQueueEvent } from '../events/event-name.enum';
import { PauseMode } from '../options/enums';

describe.each(TEST_ENGINES)('producer/consumer behavior (%s)', (engine) => {
  let h: TestQueueHandle;

  beforeEach(async () => {
    h = await createTestQueue(engine);
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('adds, claims, and completes a job', async () => {
    const completed: string[] = [];
    h.pq.on(PortQueueEvent.JOB_COMPLETED, (p) => completed.push(p.jobId));
    h.pq.createQueue<{ to: string }>({
      name: 'emails',
      handler: async (job) => ({ sent: job.data.to }),
    });
    const res = await h.pq.addJob({ queue: 'emails', data: { to: 'a@b.com' } });
    expect(res.jobId).toBeTruthy();
    expect(res.deduplicated).toBe(false);

    await waitFor(() => completed.length === 1);
    const snap = await h.pq.getJob({ jobId: res.jobId! });
    expect(snap?.status).toBe(JobStatus.COMPLETED);
    expect(snap?.returnValue).toEqual({ sent: 'a@b.com' });
  });

  it('retries a throwing handler then succeeds', async () => {
    let calls = 0;
    h.pq.createQueue({
      name: 'flaky',
      handler: async () => {
        calls += 1;
        if (calls < 3) throw new Error('boom');
        return 'ok';
      },
    });
    const res = await h.pq.addJob({
      queue: 'flaky',
      data: {},
      retry: { maxAttempts: 3, delaySeconds: 0 },
    });
    await waitFor(
      async () => (await h.pq.getJob({ jobId: res.jobId! }))?.status === JobStatus.COMPLETED,
    );
    expect(calls).toBe(3);
  });

  it('fails terminally after exhausting attempts', async () => {
    h.pq.createQueue({
      name: 'doomed',
      handler: async () => {
        throw new Error('always');
      },
    });
    const res = await h.pq.addJob({
      queue: 'doomed',
      data: {},
      retry: { maxAttempts: 2, delaySeconds: 0 },
    });
    await waitFor(
      async () => (await h.pq.getJob({ jobId: res.jobId! }))?.status === JobStatus.FAILED,
    );
    const snap = await h.pq.getJob({ jobId: res.jobId! });
    expect(snap?.failureMessage).toContain('always');
  });

  it('truncates a very long failure message rather than storing an unbounded stack', async () => {
    h.pq.createQueue({
      name: 'verbose',
      handler: async () => {
        const err = new Error('short message');
        err.stack = `Error: short message\n${'    at somewhere (file.ts:1:1)\n'.repeat(2000)}`;
        throw err;
      },
    });
    const res = await h.pq.addJob({ queue: 'verbose', data: {} });
    await waitFor(
      async () => (await h.pq.getJob({ jobId: res.jobId! }))?.status === JobStatus.FAILED,
    );
    const snap = await h.pq.getJob({ jobId: res.jobId! });
    // The throw site survives; the endless frames after it do not.
    expect(snap!.failureMessage).toContain('short message');
    expect(snap!.failureMessage).toContain('truncated');
    expect(snap!.failureMessage!.length).toBeLessThan(5000);
  });

  it('processes higher priority first', async () => {
    const order: number[] = [];
    // Enqueue before the queue is declared, so both jobs are pending when claiming starts.
    await h.pq.addJob({ queue: 'prio', data: { n: 1 }, priority: 1 });
    await h.pq.addJob({ queue: 'prio', data: { n: 2 }, priority: 10 });
    h.pq.createQueue<{ n: number }>({
      name: 'prio',
      limiter: { concurrency: 1 },
      handler: async (job) => {
        order.push(job.data.n);
      },
    });
    await waitFor(() => order.length === 2);
    expect(order[0]).toBe(2);
  });

  it('deduplicates by idempotency key', async () => {
    const a = await h.pq.addJob({ queue: 'idem', data: { x: 1 }, idempotencyKey: 'once' });
    const b = await h.pq.addJob({ queue: 'idem', data: { x: 2 }, idempotencyKey: 'once' });
    expect(b.deduplicated).toBe(true);
    expect(b.jobId).toBe(a.jobId);
  });

  it('adds a batch of jobs in one insert', async () => {
    const results = await h.pq.addJobs({
      queue: 'batch',
      jobs: [{ data: { n: 1 } }, { data: { n: 2 }, idempotencyKey: 'b-2' }, { data: { n: 3 } }],
    });
    expect(results).toHaveLength(3);
    expect(new Set(results.map((r) => r.jobId)).size).toBe(3);
    expect(results.every((r) => r.deduplicated === false)).toBe(true);

    // Order is preserved: result[i] describes jobs[i].
    const second = await h.pq.getJob<{ n: number }>({ jobId: results[1]!.jobId! });
    expect(second!.data.n).toBe(2);
    expect(second!.idempotencyKey).toBe('b-2');

    // The batch's own keys dedup on a later add.
    const again = await h.pq.addJobs({
      queue: 'batch',
      jobs: [{ data: { n: 9 }, idempotencyKey: 'b-2' }],
    });
    expect(again[0]!.deduplicated).toBe(true);
    expect(again[0]!.jobId).toBe(results[1]!.jobId);

    const page = await h.pq.getJobs({ queue: 'batch' });
    expect(page.total).toBe(3);
  });

  it('refuses a recurring entry inside a batch', async () => {
    await expect(
      h.pq.addJobs({
        queue: 'batch-recurring',
        jobs: [{ data: {} }, { data: {}, schedule: { startEverySeconds: 60 } }],
      }),
    ).rejects.toThrow(/cannot create recurring jobs/);
  });

  it('pauses and resumes processing cluster-wide', async () => {
    const done: string[] = [];
    h.pq.createQueue({ name: 'pausable', handler: async (job) => void done.push(job.id) });
    await h.pq.pauseQueue({ queue: 'pausable', mode: PauseMode.PROCESSING });
    const res = await h.pq.addJob({ queue: 'pausable', data: {} });
    // Give the loop a chance; it must NOT process while paused.
    await new Promise((r) => setTimeout(r, 100));
    expect(done).toHaveLength(0);
    await h.pq.resumeQueue({ queue: 'pausable' });
    await waitFor(() => done.includes(res.jobId!));
  });

  it('refuses new jobs when paused with ALL', async () => {
    h.pq.createQueue({ name: 'drain', handler: async () => 'ok' });
    await h.pq.pauseQueue({ queue: 'drain', mode: PauseMode.ALL });
    await expect(h.pq.addJob({ queue: 'drain', data: {} })).rejects.toThrow(/refusing new jobs/);
  });

  it('keeps a queue’s declared defaults across a pause and resume', async () => {
    // Pausing used to re-declare the queue with no options, silently dropping its retry defaults.
    h.pq.createQueue({
      name: 'defaults',
      defaultJobOptions: { retry: { maxAttempts: 5 } },
      handler: async () => 'ok',
    });
    await h.pq.addJob({ queue: 'defaults', data: { first: true } });
    await h.pq.pauseQueue({ queue: 'defaults' });
    await h.pq.resumeQueue({ queue: 'defaults' });
    const res = await h.pq.addJob({ queue: 'defaults', data: { second: true } });
    const snap = await h.pq.getJob({ jobId: res.jobId! });
    expect(snap!.retryMaxAttempts).toBe(5);
  });
});
