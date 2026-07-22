import {
  createTestQueue,
  TEST_ENGINES,
  waitFor,
  type TestQueueHandle,
} from '../test-utils/create-test-queue.js';
import { JobStatus } from '../jobs/job-state.enum.js';
import { PortQueueEvent } from '../events/event-name.enum.js';
import { HookPhase } from '../events/hooks.js';
import { BackoffStrategy, RetryMode } from '../options/enums.js';
import { defineWorkflow } from './define-workflow.js';

class NonRetryableError extends Error {
  constructor() {
    super('do-not-retry');
    this.name = 'NonRetryableError';
  }
}

describe.each(TEST_ENGINES)('feature coverage (%s)', (engine) => {
  let h: TestQueueHandle;
  beforeEach(async () => {
    h = await createTestQueue(engine);
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('dontAutoretryFor short-circuits retries to FAILED', async () => {
    const queue = h.pq.createQueue('nr');
    let calls = 0;
    h.pq.createWorker({
      queue: 'nr',
      dontAutoretryFor: [NonRetryableError],
      handler: async () => {
        calls += 1;
        throw new NonRetryableError();
      },
    });
    const res = await queue.addJob({ data: {}, retryMaxAttempts: 5, retryDelay: 0 });
    await waitFor(
      async () => (await queue.getJob({ jobId: res.jobId! }))?.status === JobStatus.FAILED,
    );
    expect(calls).toBe(1); // no retries consumed
  });

  it('matches dontAutoretryFor by error name string too', async () => {
    const queue = h.pq.createQueue('nr2');
    let calls = 0;
    h.pq.createWorker({
      queue: 'nr2',
      dontAutoretryFor: ['CustomFatal'],
      handler: async () => {
        calls += 1;
        const e = new Error('x');
        e.name = 'CustomFatal';
        throw e;
      },
    });
    const res = await queue.addJob({ data: {}, retryMaxAttempts: 5, retryDelay: 0 });
    await waitFor(
      async () => (await queue.getJob({ jobId: res.jobId! }))?.status === JobStatus.FAILED,
    );
    expect(calls).toBe(1);
  });

  it('exponential backoff lands the retry in the future', async () => {
    const queue = h.pq.createQueue('bk');
    const res = await queue.addJob({
      data: {},
      retryMaxAttempts: 3,
      retryDelay: 1000,
      retryBackoff: { strategy: BackoffStrategy.EXPONENTIAL, factor: 2 },
    });
    // Claim + fail once at the driver level to observe the RETRY scheduling.
    const row = await h.pq.createQueue('bk').ensure();
    void row;
    h.pq.createWorker({
      queue: 'bk',
      handler: async () => {
        throw new Error('boom');
      },
    });
    await waitFor(
      async () => (await queue.getJob({ jobId: res.jobId! }))?.status === JobStatus.RETRY,
    );
    const snap = await queue.getJob({ jobId: res.jobId! });
    expect(snap!.startAfter.getTime()).toBeGreaterThan(h.clock.now());
    expect(snap!.retryAttempt).toBe(1);
  });

  it('enforces singletonKey (only one active/pending at a time)', async () => {
    const queue = h.pq.createQueue('sng');
    const a = await queue.addJob({ data: { n: 1 }, singletonKey: 'only' });
    const b = await queue.addJob({ data: { n: 2 }, singletonKey: 'only' });
    expect(b.deduplicated).toBe(true);
    expect(b.deduplicationReason).toBe('SINGLETON');
    expect(b.jobId).toBe(a.jobId);
  });

  it('does not run a delayed job until it becomes due', async () => {
    const queue = h.pq.createQueue('delayed');
    const done: string[] = [];
    h.pq.createWorker({
      queue: 'delayed',
      pollIntervalMs: 20,
      handler: async (job) => void done.push(job.id),
    });
    const res = await queue.addJob({ data: {}, delay: 60_000 });
    await new Promise((r) => setTimeout(r, 120));
    expect(done).toHaveLength(0);
    h.clock.advance(61_000);
    await waitFor(() => done.includes(res.jobId!));
  });

  it('expires a PENDING job past its expireIn deadline', async () => {
    const queue = h.pq.createQueue('exp');
    // No worker — it must expire before ever running.
    const res = await queue.addJob({ data: {}, expireIn: 1000 });
    h.clock.advance(2000);
    await waitFor(
      async () => (await queue.getJob({ jobId: res.jobId! }))?.status === JobStatus.EXPIRED,
    );
  });

  it('cancels a not-yet-active job', async () => {
    const queue = h.pq.createQueue('cancel');
    const res = await queue.addJob({ data: {}, delay: 60_000 });
    const ok = await queue.cancelJob({ jobId: res.jobId! });
    expect(ok).toBe(true);
    expect((await queue.getJob({ jobId: res.jobId! }))?.status).toBe(JobStatus.CANCELLED);
  });

  it('cooperatively cancels a running job via job.signal', async () => {
    const queue = h.pq.createQueue('coop');
    let aborted = false;
    h.pq.createWorker({
      queue: 'coop',
      pollIntervalMs: 20,
      handler: async (job) => {
        await new Promise<void>((resolve) => {
          job.signal.addEventListener('abort', () => {
            aborted = true;
            resolve();
          });
        });
      },
    });
    const res = await queue.addJob({ data: {} });
    await waitFor(
      async () => (await queue.getJob({ jobId: res.jobId! }))?.status === JobStatus.ACTIVE,
    );
    const signaled = await queue.cancelRunningJob({ jobId: res.jobId! });
    expect(signaled).toBe(true);
    await waitFor(() => aborted);
  });

  it('runs BEFORE_ADD (mutate) and AFTER_PROCESS hooks', async () => {
    const queue = h.pq.createQueue<{ tenant?: string }>('hooked');
    const outcomes: string[] = [];
    h.pq.useHook({
      phase: HookPhase.BEFORE_ADD,
      queue: 'hooked',
      handler: (ctx: { queue: string; options: { data: unknown } }) => ({
        options: {
          metadata: { injected: true },
          data: { ...(ctx.options.data as object), tenant: 't1' },
        },
      }),
    });
    h.pq.useHook({
      phase: HookPhase.AFTER_PROCESS,
      queue: 'hooked',
      handler: (ctx: { outcome: { kind: string } }) => void outcomes.push(ctx.outcome.kind),
    });
    let seenTenant: string | undefined;
    h.pq.createWorker<{ tenant?: string }>({
      queue: 'hooked',
      handler: async (job) => {
        seenTenant = job.data.tenant;
      },
    });
    const res = await queue.addJob({ data: {} });
    await waitFor(
      async () => (await queue.getJob({ jobId: res.jobId! }))?.status === JobStatus.COMPLETED,
    );
    expect(seenTenant).toBe('t1');
    expect(outcomes).toContain('completed');
    const snap = await queue.getJob({ jobId: res.jobId! });
    expect(snap!.metadata).toMatchObject({ injected: true });
  });

  it('vetoes an add when a BEFORE_ADD hook throws', async () => {
    const queue = h.pq.createQueue('veto');
    h.pq.useHook({
      phase: HookPhase.BEFORE_ADD,
      queue: 'veto',
      handler: () => {
        throw new Error('not allowed');
      },
    });
    await expect(queue.addJob({ data: {} })).rejects.toThrow('not allowed');
  });

  it('filters events by queue', async () => {
    const a = h.pq.createQueue('qa');
    h.pq.createQueue('qb');
    const seen: string[] = [];
    h.pq.on(PortQueueEvent.JOB_ADDED, (p) => seen.push(p.queue), { queue: 'qa' });
    await a.addJob({ data: {} });
    await h.pq.createQueue('qb').addJob({ data: {} });
    expect(seen).toEqual(['qa']);
  });

  it('removes and purges jobs', async () => {
    const queue = h.pq.createQueue('rm');
    const a = await queue.addJob({ data: { n: 1 } });
    const b = await queue.addJob({ data: { n: 2 } });
    expect(await queue.removeJob({ jobId: a.jobId! })).toBe(true);
    expect(await queue.getJob({ jobId: a.jobId! })).toBeNull();
    const purged = await queue.purgeJobs({ statuses: [JobStatus.PENDING] });
    expect(purged).toBe(1);
    expect(await queue.getJob({ jobId: b.jobId! })).toBeNull();
  });

  it('applies a worker-local rate limiter', async () => {
    const queue = h.pq.createQueue('rate');
    const started: string[] = [];
    h.pq.createWorker({
      queue: 'rate',
      concurrency: 5,
      pollIntervalMs: 20,
      limiter: { max: 2, duration: 10_000 },
      handler: async (job) => {
        started.push(job.id);
        await new Promise((r) => setTimeout(r, 50));
      },
    });
    for (let i = 0; i < 5; i += 1) await queue.addJob({ data: { i } });
    await new Promise((r) => setTimeout(r, 150));
    // Only the 2 tokens available in this window may have started.
    expect(started.length).toBeLessThanOrEqual(2);
  });

  it('repeats a workflow step then finishes', async () => {
    const wf = defineWorkflow<{ count: number }>({
      queue: 'repeatwf',
      steps: [
        {
          key: 'tick',
          handler: async (job, step) =>
            job.data.count >= 2
              ? step.done({ result: job.data.count })
              : step.repeat({ data: { count: job.data.count + 1 } }),
        },
      ],
    });
    const queue = h.pq.createQueue(wf);
    h.pq.createWorker(wf);
    const res = await queue.addJob({ data: { count: 0 } });
    await waitFor(async () => {
      const run = await h.pq.getWorkflow({ workflowId: res.workflowId! });
      return (
        run != null &&
        run.steps.length === 3 &&
        run.steps.every((s) => s.status === JobStatus.COMPLETED)
      );
    });
    const run = await h.pq.getWorkflow({ workflowId: res.workflowId! });
    expect(run!.steps).toHaveLength(3); // 0->1, 1->2, 2 done — three step jobs
  });

  it('retries a failed workflow from the failed step (FROM_FAILED_STEP)', async () => {
    let failFirst = true;
    const wf = defineWorkflow<{ v: number }>({
      queue: 'retrywf',
      steps: [
        { key: 'a', handler: async (_j, step) => step.next({ data: { v: 1 } }) },
        {
          key: 'b',
          handler: async (job, step) => {
            if (failFirst) {
              failFirst = false;
              throw new Error('step b failed');
            }
            return step.done({ result: job.data.v });
          },
        },
      ],
    });
    const queue = h.pq.createQueue(wf);
    h.pq.createWorker(wf);
    const res = await queue.addJob({ data: { v: 0 }, retryMaxAttempts: 1 });
    // Step b fails terminally (1 attempt) → find its FAILED job.
    let failedJobId = '';
    await waitFor(async () => {
      const run = await h.pq.getWorkflow({ workflowId: res.workflowId! });
      const failed = run?.steps.find(
        (s) => s.status === JobStatus.FAILED && s.workflowStepKey === 'b',
      );
      if (failed) failedJobId = failed.id;
      return Boolean(failed);
    });
    await queue.retryJob({ jobId: failedJobId, from: RetryMode.FROM_FAILED_STEP });
    await waitFor(async () => {
      const run = await h.pq.getWorkflow({ workflowId: res.workflowId! });
      return Boolean(
        run?.steps.some((s) => s.workflowStepKey === 'b' && s.status === JobStatus.COMPLETED),
      );
    });
  });
});
