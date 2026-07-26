import {
  createTestQueue,
  TEST_ENGINES,
  waitFor,
  type TestQueueHandle,
} from '../test-utils/create-test-queue';
import { JobStatus } from '../jobs/job-state.enum';
import { PortQueueEvent } from '../events/event-name.enum';
import { HookPhase } from '../events/hooks';
import { BackoffStrategy } from '../options/enums';

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
    const res = await queue.addJob({ data: {}, retry: { maxAttempts: 5, delaySeconds: 0 } });
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
    const res = await queue.addJob({ data: {}, retry: { maxAttempts: 5, delaySeconds: 0 } });
    await waitFor(
      async () => (await queue.getJob({ jobId: res.jobId! }))?.status === JobStatus.FAILED,
    );
    expect(calls).toBe(1);
  });

  it('exponential backoff lands the retry in the future', async () => {
    const queue = h.pq.createQueue('bk');
    const res = await queue.addJob({
      data: {},
      retry: {
        maxAttempts: 3,
        delaySeconds: 1,
        backoff: { strategy: BackoffStrategy.EXPONENTIAL, factor: 2 },
      },
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
      limiter: { pollIntervalSeconds: 0.02 },
      handler: async (job) => void done.push(job.id),
    });
    const res = await queue.addJob({ data: {}, schedule: { startAfterSeconds: 60 } });
    await new Promise((r) => setTimeout(r, 120));
    expect(done).toHaveLength(0);
    h.clock.advance(61_000);
    await waitFor(() => done.includes(res.jobId!));
  });

  it('expires a PENDING job past its expireInSeconds deadline', async () => {
    const queue = h.pq.createQueue('exp');
    // No worker — it must expire before ever running.
    const res = await queue.addJob({ data: {}, expireInSeconds: 1 });
    h.clock.advance(2000);
    await waitFor(
      async () => (await queue.getJob({ jobId: res.jobId! }))?.status === JobStatus.EXPIRED,
    );
  });

  it('cancels a not-yet-active job', async () => {
    const queue = h.pq.createQueue('cancel');
    const res = await queue.addJob({ data: {}, schedule: { startAfterSeconds: 60 } });
    const ok = await queue.cancelJob({ jobId: res.jobId! });
    expect(ok).toBe(true);
    expect((await queue.getJob({ jobId: res.jobId! }))?.status).toBe(JobStatus.CANCELLED);
  });

  it('cooperatively cancels a running job via job.signal', async () => {
    const queue = h.pq.createQueue('coop');
    let aborted = false;
    h.pq.createWorker({
      queue: 'coop',
      limiter: { pollIntervalSeconds: 0.02 },
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
    const signaled = await queue.cancelJob({ jobId: res.jobId! });
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

  it('removes jobs by id and by status', async () => {
    const queue = h.pq.createQueue('rm');
    const a = await queue.addJob({ data: { n: 1 } });
    const b = await queue.addJob({ data: { n: 2 } });
    expect(await queue.removeJob({ jobId: a.jobId! })).toBe(true);
    expect(await queue.getJob({ jobId: a.jobId! })).toBeNull();
    const removed = await queue.removeJobs({ statuses: [JobStatus.PENDING] });
    expect(removed).toBe(1);
    expect(await queue.getJob({ jobId: b.jobId! })).toBeNull();
  });

  it('applies a worker-local rate limiter', async () => {
    const queue = h.pq.createQueue('rate');
    const started: string[] = [];
    h.pq.createWorker({
      queue: 'rate',
      limiter: { concurrency: 5, pollIntervalSeconds: 0.02, rateMax: 2, rateDurationSeconds: 10 },
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
});
