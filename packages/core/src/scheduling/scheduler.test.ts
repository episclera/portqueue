import {
  createTestQueue,
  TEST_ENGINES,
  waitFor,
  type TestQueueHandle,
} from '../test-utils/create-test-queue';
import { JobStatus } from '../jobs/job-state.enum';
import { RetentionMode } from '../options/enums';

describe.each(TEST_ENGINES)('scheduling & retention (%s)', (engine) => {
  let h: TestQueueHandle;

  beforeEach(async () => {
    h = await createTestQueue(engine);
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('produces a job from an interval schedule and stamps scheduleId', async () => {
    const queue = h.pq.createQueue('reports');
    const res = await queue.addJob({
      data: { report: 'daily' },
      schedule: { startEverySeconds: 1 },
    });
    expect(res.scheduleId).toBeTruthy();
    expect(res.nextRunAt).toBeInstanceOf(Date);

    // Advance the clock past the next run; the maintenance tick (real timer) then fires it.
    h.clock.advance(2000);
    await waitFor(async () => {
      const page = await queue.getJobs({ scheduleId: res.scheduleId! });
      return page.items.length >= 1;
    });
    const page = await queue.getJobs({ scheduleId: res.scheduleId! });
    expect(page.items[0]!.scheduleId).toBe(res.scheduleId);
  });

  it('carries per-job options (expireInSeconds) from a recurring add onto every spawned job', async () => {
    const queue = h.pq.createQueue('carry');
    // No worker: a produced run just sits until it expires. The recurring add sets
    // expireInSeconds, which must ride along and apply to each spawned job (relative to its own
    // fire time). Without carry-through the produced job would have no deadline and never expire.
    const res = await queue.addJob({
      data: {},
      schedule: { startEverySeconds: 1 },
      expireInSeconds: 1,
    });

    // Fire the first run.
    h.clock.advance(1500);
    let jobId = '';
    await waitFor(async () => {
      const page = await queue.getJobs({ scheduleId: res.scheduleId! });
      if (page.items[0]) jobId = page.items[0].id;
      return page.items.length >= 1;
    });

    // Push past the produced job's 1-second deadline; the maintenance tick expires it.
    h.clock.advance(2000);
    await waitFor(async () => (await queue.getJob({ jobId }))?.status === JobStatus.EXPIRED);
    expect((await queue.getJob({ jobId }))!.status).toBe(JobStatus.EXPIRED);
  });

  it('lists schedules and removes them', async () => {
    const queue = h.pq.createQueue('sched');
    const res = await queue.addJob({ data: {}, schedule: { cron: '0 0 * * *' } });
    let schedules = await queue.getSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]!.cron).toBe('0 0 * * *');

    const removed = await queue.removeSchedule({ scheduleId: res.scheduleId! });
    expect(removed).toBe(true);
    schedules = await queue.getSchedules();
    expect(schedules).toHaveLength(0);
  });

  it('allows identical recurrences on a queue to coexist (no dedup without a key)', async () => {
    const queue = h.pq.createQueue('sched-dup');
    const a = await queue.addJob({ data: { n: 1 }, schedule: { cron: '0 0 * * *' } });
    const b = await queue.addJob({ data: { n: 2 }, schedule: { cron: '0 0 * * *' } });
    expect(b.scheduleId).not.toBe(a.scheduleId);
    expect(b.deduplicated).toBe(false);
    expect(await queue.getSchedules()).toHaveLength(2);
  });

  it('deduplicates schedules by idempotency key (keeps the first, unchanged)', async () => {
    const queue = h.pq.createQueue('sched-idem');
    const a = await queue.addJob({
      data: { n: 1 },
      schedule: { cron: '0 0 * * *' },
      idempotencyKey: 'daily',
    });
    const b = await queue.addJob({
      data: { n: 2 },
      schedule: { cron: '0 0 * * *' },
      idempotencyKey: 'daily',
    });
    expect(b.deduplicated).toBe(true);
    expect(b.scheduleId).toBe(a.scheduleId);
    const schedules = await queue.getSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]!.idempotencyKey).toBe('daily');
  });

  it('idempotency key dedups per table — one-off and recurring keys are independent', async () => {
    const queue = h.pq.createQueue('sched-cross');
    // A one-off add only checks the jobs table.
    const job = await queue.addJob({ data: {}, idempotencyKey: 'shared' });
    // A recurring add with the same key checks only the schedule table, so it is NOT deduped
    // against the existing one-off job — it creates its own schedule.
    const sched = await queue.addJob({
      data: {},
      schedule: { cron: '0 0 * * *' },
      idempotencyKey: 'shared',
    });
    expect(sched.deduplicated).toBe(false);
    expect(sched.scheduleId).toBeTruthy();
    expect(sched.jobId).toBeUndefined();
    expect(await queue.getSchedules()).toHaveLength(1);

    // A second one-off add with that key dedups against the existing job (jobs table only).
    const dupJob = await queue.addJob({ data: {}, idempotencyKey: 'shared' });
    expect(dupJob.deduplicated).toBe(true);
    expect(dupJob.jobId).toBe(job.jobId);
    expect(dupJob.scheduleId).toBeUndefined();

    // A second recurring add with that key dedups against the existing schedule (schedule table only).
    const dupSched = await queue.addJob({
      data: {},
      schedule: { cron: '0 0 * * *' },
      idempotencyKey: 'shared',
    });
    expect(dupSched.deduplicated).toBe(true);
    expect(dupSched.scheduleId).toBe(sched.scheduleId);
    expect(await queue.getSchedules()).toHaveLength(1);
  });

  it('deletes finished jobs after their retention TTL elapses', async () => {
    const queue = h.pq.createQueue('ephemeral');
    h.pq.createWorker({ queue: 'ephemeral', handler: async () => 'done' });
    const res = await queue.addJob({
      data: {},
      retention: {
        mode: RetentionMode.DELETE_AFTER,
        ttlSeconds: 1,
        statuses: [JobStatus.COMPLETED],
      },
    });
    await waitFor(
      async () => (await queue.getJob({ jobId: res.jobId! }))?.status === JobStatus.COMPLETED,
    );

    // Before the TTL elapses the job is retained.
    expect(await queue.getJob({ jobId: res.jobId! })).not.toBeNull();

    // Advance past the TTL; the retention sweep (maintenance tick) removes it.
    h.clock.advance(5000);
    await waitFor(async () => (await queue.getJob({ jobId: res.jobId! })) === null);
  });

  it('rejects an unknown schedule key instead of quietly running the job now', async () => {
    const queue = h.pq.createQueue('typo');
    // The old absolute-Date `startAfter` is gone, and `startEvery` never existed without its unit.
    // Dropping either silently would look like the scheduler losing the job.
    await expect(
      queue.addJob({ data: {}, schedule: { startAfter: new Date() } } as never),
    ).rejects.toThrow(/Unknown 'schedule' option on queue 'typo': 'startAfter'/);
    await expect(queue.addJob({ data: {}, schedule: { startEvery: 30 } } as never)).rejects.toThrow(
      /Unknown 'schedule' option on queue 'typo': 'startEvery'/,
    );
  });

  it('refuses a one-off delay combined with a recurring cadence', async () => {
    const queue = h.pq.createQueue('both');
    await expect(
      queue.addJob({ data: {}, schedule: { startAfterSeconds: 5, startEverySeconds: 10 } }),
    ).rejects.toThrow(/Cannot combine 'schedule.startAfterSeconds'/);
  });
});
