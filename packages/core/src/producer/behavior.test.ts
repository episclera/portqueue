import {
  createTestQueue,
  TEST_ENGINES,
  waitFor,
  type TestQueueHandle,
} from '../test-utils/create-test-queue';
import { JobStatus } from '../jobs/job-state.enum';
import { PortQueueEvent } from '../events/event-name.enum';
import { PauseMode } from '../options/enums';
import type { WorkflowStep } from '../jobs/job';

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
    const queue = h.pq.createQueue<{ to: string }>('emails');
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
    const queue = h.pq.createQueue('flaky');
    h.pq.createWorker({
      queue: 'flaky',
      handler: async () => {
        calls += 1;
        if (calls < 3) throw new Error('boom');
        return 'ok';
      },
    });
    const res = await queue.addJob({ data: {}, retry: { maxAttempts: 3, delay: 0 } });
    await waitFor(
      async () => (await queue.getJob({ jobId: res.jobId! }))?.status === JobStatus.COMPLETED,
    );
    expect(calls).toBe(3);
  });

  it('fails terminally after exhausting attempts', async () => {
    const queue = h.pq.createQueue('doomed');
    h.pq.createWorker({
      queue: 'doomed',
      handler: async () => {
        throw new Error('always');
      },
    });
    const res = await queue.addJob({ data: {}, retry: { maxAttempts: 2, delay: 0 } });
    await waitFor(
      async () => (await queue.getJob({ jobId: res.jobId! }))?.status === JobStatus.FAILED,
    );
    const snap = await queue.getJob({ jobId: res.jobId! });
    expect(snap?.failureMessage).toContain('always');
  });

  it('processes higher priority first', async () => {
    const order: number[] = [];
    const queue = h.pq.createQueue<{ n: number }>('prio');
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
    const queue = h.pq.createQueue('idem');
    const a = await queue.addJob({ data: { x: 1 }, idempotencyKey: 'once' });
    const b = await queue.addJob({ data: { x: 2 }, idempotencyKey: 'once' });
    expect(b.deduplicated).toBe(true);
    expect(b.jobId).toBe(a.jobId);
  });

  it('pauses and resumes processing cluster-wide', async () => {
    const done: string[] = [];
    const queue = h.pq.createQueue('pausable');
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
    const queue = h.pq.createQueue('drain');
    await queue.pause({ mode: PauseMode.ALL });
    await expect(queue.addJob({ data: {} })).rejects.toThrow(/refusing new jobs/);
  });

  it('runs a multi-step workflow to completion', async () => {
    const steps: WorkflowStep<{ total: number }>[] = [
      { key: 'reserve', handler: async (_job, step) => step.next({ data: { total: 10 } }) },
      {
        key: 'charge',
        handler: async (job, step) => step.next({ data: { total: job.data.total + 5 } }),
      },
      { key: 'ship', handler: async (job, step) => step.done({ result: job.data.total }) },
    ];
    const queue = h.pq.createQueue<{ total: number }>('orders');
    h.pq.createWorker<{ total: number }>({ queue: 'orders', handler: steps });
    const res = await queue.addJob({ data: { total: 0 } });
    expect(res.workflowId).toBeTruthy();

    await waitFor(async () => {
      const run = await h.pq.getWorkflow({ workflowId: res.workflowId! });
      return (
        run != null &&
        run.steps.length === 3 &&
        run.steps.every((s) => s.status === JobStatus.COMPLETED)
      );
    });
    const run = await h.pq.getWorkflow({ workflowId: res.workflowId! });
    expect(run!.steps.map((s) => s.workflowStepKey)).toEqual(['reserve', 'charge', 'ship']);
    expect(run!.steps[2]!.returnValue).toBe(15);
  });
});
