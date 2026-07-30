import {
  createTestQueue,
  TEST_ENGINES,
  waitFor,
  type TestQueueHandle,
} from '../test-utils/create-test-queue';
import { JobStatus } from '../jobs/job-state.enum';
import { PortQueueEvent } from '../events/event-name.enum';
import { HookPhase } from '../events/hooks';
import { BackoffStrategy, RetentionMode } from '../options/enums';

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
    h.pq.createQueue({ name: 'nr' });
    let calls = 0;
    h.pq.createWorker({
      queue: 'nr',
      dontAutoretryFor: [NonRetryableError],
      handler: async () => {
        calls += 1;
        throw new NonRetryableError();
      },
    });
    const res = await h.pq.addJob({
      queue: 'nr',
      data: {},
      retry: { maxAttempts: 5, delaySeconds: 0 },
    });
    await waitFor(
      async () => (await h.pq.getJob({ jobId: res.jobId! }))?.status === JobStatus.FAILED,
    );
    expect(calls).toBe(1); // no retries consumed
  });

  it('matches dontAutoretryFor by error name string too', async () => {
    h.pq.createQueue({ name: 'nr2' });
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
    const res = await h.pq.addJob({
      queue: 'nr2',
      data: {},
      retry: { maxAttempts: 5, delaySeconds: 0 },
    });
    await waitFor(
      async () => (await h.pq.getJob({ jobId: res.jobId! }))?.status === JobStatus.FAILED,
    );
    expect(calls).toBe(1);
  });

  it('exponential backoff lands the retry in the future', async () => {
    h.pq.createQueue({ name: 'bk' });
    const res = await h.pq.addJob({
      queue: 'bk',
      data: {},
      retry: {
        maxAttempts: 3,
        delaySeconds: 1,
        backoff: { strategy: BackoffStrategy.EXPONENTIAL, factor: 2 },
      },
    });
    h.pq.createWorker({
      queue: 'bk',
      handler: async () => {
        throw new Error('boom');
      },
    });
    await waitFor(
      async () => (await h.pq.getJob({ jobId: res.jobId! }))?.status === JobStatus.RETRY,
    );
    const snap = await h.pq.getJob({ jobId: res.jobId! });
    expect(snap!.startAfter.getTime()).toBeGreaterThan(h.clock.now());
    expect(snap!.retryAttempt).toBe(1);
  });

  it('enforces singletonKey (only one active/pending at a time)', async () => {
    h.pq.createQueue({ name: 'sng' });
    const a = await h.pq.addJob({ queue: 'sng', data: { n: 1 }, singletonKey: 'only' });
    const b = await h.pq.addJob({ queue: 'sng', data: { n: 2 }, singletonKey: 'only' });
    expect(b.deduplicated).toBe(true);
    expect(b.deduplicationReason).toBe('SINGLETON');
    expect(b.jobId).toBe(a.jobId);
  });

  it('does not run a delayed job until it becomes due', async () => {
    h.pq.createQueue({ name: 'delayed' });
    const done: string[] = [];
    h.pq.createWorker({
      queue: 'delayed',
      limiter: { pollIntervalSeconds: 0.02 },
      handler: async (job) => void done.push(job.id),
    });
    const res = await h.pq.addJob({
      queue: 'delayed',
      data: {},
      schedule: { startAfterSeconds: 60 },
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(done).toHaveLength(0);
    h.clock.advance(61_000);
    await waitFor(() => done.includes(res.jobId!));
  });

  it('expires a PENDING job past its expireInSeconds deadline', async () => {
    h.pq.createQueue({ name: 'exp' });
    // No worker — it must expire before ever running.
    const res = await h.pq.addJob({ queue: 'exp', data: {}, expireInSeconds: 1 });
    h.clock.advance(2000);
    await waitFor(
      async () => (await h.pq.getJob({ jobId: res.jobId! }))?.status === JobStatus.EXPIRED,
    );
  });

  it('cancels a not-yet-active job', async () => {
    h.pq.createQueue({ name: 'cancel' });
    const res = await h.pq.addJob({
      queue: 'cancel',
      data: {},
      schedule: { startAfterSeconds: 60 },
    });
    const ok = await h.pq.cancelJob({ jobId: res.jobId! });
    expect(ok).toBe(true);
    expect((await h.pq.getJob({ jobId: res.jobId! }))?.status).toBe(JobStatus.CANCELLED);
  });

  it('cooperatively cancels a running job via job.signal', async () => {
    h.pq.createQueue({ name: 'coop' });
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
    const res = await h.pq.addJob({ queue: 'coop', data: {} });
    await waitFor(
      async () => (await h.pq.getJob({ jobId: res.jobId! }))?.status === JobStatus.ACTIVE,
    );
    const signaled = await h.pq.cancelJob({ jobId: res.jobId! });
    expect(signaled).toBe(true);
    await waitFor(() => aborted);
  });

  it('runs BEFORE_ADD (mutate) and AFTER_PROCESS hooks', async () => {
    h.pq.createQueue<{ tenant?: string }>({ name: 'hooked' });
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
    const res = await h.pq.addJob({ queue: 'hooked', data: {} });
    await waitFor(
      async () => (await h.pq.getJob({ jobId: res.jobId! }))?.status === JobStatus.COMPLETED,
    );
    expect(seenTenant).toBe('t1');
    expect(outcomes).toContain('completed');
  });

  it('vetoes an add when a BEFORE_ADD hook throws', async () => {
    h.pq.createQueue({ name: 'veto' });
    h.pq.useHook({
      phase: HookPhase.BEFORE_ADD,
      queue: 'veto',
      handler: () => {
        throw new Error('not allowed');
      },
    });
    await expect(h.pq.addJob({ queue: 'veto', data: {} })).rejects.toThrow('not allowed');
  });

  it('filters events by queue', async () => {
    h.pq.createQueue({ name: 'qa' });
    h.pq.createQueue({ name: 'qb' });
    const seen: string[] = [];
    h.pq.on(PortQueueEvent.JOB_ADDED, (p) => seen.push(p.queue), { queue: 'qa' });
    await h.pq.addJob({ queue: 'qa', data: {} });
    await h.pq.addJob({ queue: 'qb', data: {} });
    expect(seen).toEqual(['qa']);
  });

  it('registers queue-scoped hooks once even when the queue is re-declared', async () => {
    const seen: string[] = [];
    h.pq.createQueue({
      name: 'hook-once',
      hooks: [{ phase: HookPhase.BEFORE_ADD, handler: () => void seen.push('before') }],
    });
    // A second declaration must not stack a duplicate registration onto every add.
    h.pq.createQueue({
      name: 'hook-once',
      hooks: [{ phase: HookPhase.BEFORE_ADD, handler: () => void seen.push('before') }],
    });
    await h.pq.addJob({ queue: 'hook-once', data: {} });
    expect(seen).toEqual(['before']);
  });

  it('removes jobs by id and by status', async () => {
    h.pq.createQueue({ name: 'rm' });
    const a = await h.pq.addJob({ queue: 'rm', data: { n: 1 } });
    const b = await h.pq.addJob({ queue: 'rm', data: { n: 2 } });
    expect(await h.pq.removeJob({ jobId: a.jobId! })).toBe(true);
    expect(await h.pq.getJob({ jobId: a.jobId! })).toBeNull();
    const removed = await h.pq.removeJobs({ queue: 'rm', statuses: [JobStatus.PENDING] });
    expect(removed).toBe(1);
    expect(await h.pq.getJob({ jobId: b.jobId! })).toBeNull();
  });

  it('honours retention.statuses instead of sweeping every finished status', async () => {
    // Same TTL for both jobs, but the policy names COMPLETED only, so the failed one must survive.
    h.pq.createQueue({
      name: 'retained',
      retention: {
        mode: RetentionMode.DELETE_AFTER,
        ttlSeconds: 1,
        statuses: [JobStatus.COMPLETED],
      },
    });
    let shouldFail = false;
    h.pq.createWorker({
      queue: 'retained',
      limiter: { pollIntervalSeconds: 0.02 },
      handler: async () => {
        if (shouldFail) throw new Error('nope');
        return 'ok';
      },
    });
    const done = await h.pq.addJob({ queue: 'retained', data: { kind: 'done' } });
    await waitFor(
      async () => (await h.pq.getJob({ jobId: done.jobId! }))?.status === JobStatus.COMPLETED,
    );
    shouldFail = true;
    const failed = await h.pq.addJob({ queue: 'retained', data: { kind: 'failed' } });
    await waitFor(
      async () => (await h.pq.getJob({ jobId: failed.jobId! }))?.status === JobStatus.FAILED,
    );

    h.clock.advance(10_000);
    await waitFor(async () => (await h.pq.getJob({ jobId: done.jobId! })) === null);
    // The failed job is outside this policy's scope and must still be there.
    expect(await h.pq.getJob({ jobId: failed.jobId! })).not.toBeNull();
  });

  it('applies a worker-local rate limiter', async () => {
    h.pq.createQueue({ name: 'rate' });
    const started: string[] = [];
    h.pq.createWorker({
      queue: 'rate',
      limiter: { concurrency: 5, pollIntervalSeconds: 0.02, rateMax: 2, rateDurationSeconds: 10 },
      handler: async (job) => {
        started.push(job.id);
        await new Promise((r) => setTimeout(r, 50));
      },
    });
    for (let i = 0; i < 5; i += 1) await h.pq.addJob({ queue: 'rate', data: { i } });
    await new Promise((r) => setTimeout(r, 150));
    // Only the 2 tokens available in this window may have started.
    expect(started.length).toBeLessThanOrEqual(2);
  });
});
