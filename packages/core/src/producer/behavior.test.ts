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
    const queue = h.pq.createQueue<{ to: string }>({ name: 'emails' });
    h.pq.createWorker<{ to: string }>({
      queue: 'emails',
      handler: async (job) => ({ sent: job.data.to }),
    });
    const res = await queue.addJob({ data: { to: 'a@b.com' } });
    expect(res.jobId).toBeTruthy();
    expect(res.deduplicated).toBe(false);

    await waitFor(() => completed.length === 1);
    const snap = await queue.getJob({ jobId: res.jobId! });
    expect(snap?.status).toBe(JobStatus.COMPLETED);
    expect(snap?.returnValue).toEqual({ sent: 'a@b.com' });
  });

  it('retries a throwing handler then succeeds', async () => {
    let calls = 0;
    const queue = h.pq.createQueue({ name: 'flaky' });
    h.pq.createWorker({
      queue: 'flaky',
      handler: async () => {
        calls += 1;
        if (calls < 3) throw new Error('boom');
        return 'ok';
      },
    });
    const res = await queue.addJob({ data: {}, retry: { maxAttempts: 3, delaySeconds: 0 } });
    await waitFor(
      async () => (await queue.getJob({ jobId: res.jobId! }))?.status === JobStatus.COMPLETED,
    );
    expect(calls).toBe(3);
  });

  it('fails terminally after exhausting attempts', async () => {
    const queue = h.pq.createQueue({ name: 'doomed' });
    h.pq.createWorker({
      queue: 'doomed',
      handler: async () => {
        throw new Error('always');
      },
    });
    const res = await queue.addJob({ data: {}, retry: { maxAttempts: 2, delaySeconds: 0 } });
    await waitFor(
      async () => (await queue.getJob({ jobId: res.jobId! }))?.status === JobStatus.FAILED,
    );
    const snap = await queue.getJob({ jobId: res.jobId! });
    expect(snap?.failureMessage).toContain('always');
  });

  it('processes higher priority first', async () => {
    const order: number[] = [];
    const queue = h.pq.createQueue<{ n: number }>({ name: 'prio' });
    // Add before creating the worker so both jobs are pending when claiming starts.
    await queue.addJob({ data: { n: 1 }, priority: 1 });
    await queue.addJob({ data: { n: 2 }, priority: 10 });
    h.pq.createWorker<{ n: number }>({
      queue: 'prio',
      limiter: { concurrency: 1 },
      handler: async (job) => {
        order.push(job.data.n);
      },
    });
    await waitFor(() => order.length === 2);
    expect(order[0]).toBe(2);
  });

  it('deduplicates by idempotency key', async () => {
    const queue = h.pq.createQueue({ name: 'idem' });
    const a = await queue.addJob({ data: { x: 1 }, idempotencyKey: 'once' });
    const b = await queue.addJob({ data: { x: 2 }, idempotencyKey: 'once' });
    expect(b.deduplicated).toBe(true);
    expect(b.jobId).toBe(a.jobId);
  });

  it('pauses and resumes processing cluster-wide', async () => {
    const done: string[] = [];
    const queue = h.pq.createQueue({ name: 'pausable' });
    h.pq.createWorker({ queue: 'pausable', handler: async (job) => void done.push(job.id) });
    await queue.pause({ mode: PauseMode.PROCESSING });
    const res = await queue.addJob({ data: {} });
    // Give the loop a chance; it must NOT process while paused.
    await new Promise((r) => setTimeout(r, 100));
    expect(done).toHaveLength(0);
    await queue.resume();
    await waitFor(() => done.includes(res.jobId!));
  });

  it('refuses new jobs when paused with ALL', async () => {
    const queue = h.pq.createQueue({ name: 'drain' });
    await queue.pause({ mode: PauseMode.ALL });
    await expect(queue.addJob({ data: {} })).rejects.toThrow(/refusing new jobs/);
  });
});
