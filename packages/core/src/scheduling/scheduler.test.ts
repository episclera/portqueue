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
    h.pq.createQueue({ name: 'reports' });
    const res = await h.pq.addJob({
      queue: 'reports',
      data: { report: 'daily' },
      schedule: { startEverySeconds: 1 },
    });
    expect(res.scheduleId).toBeTruthy();
    expect(res.nextRunAt).toBeInstanceOf(Date);

    // Advance the clock past the next run; the maintenance tick (real timer) then fires it.
    h.clock.advance(2000);
    await waitFor(async () => {
      const page = await h.pq.getJobs({ scheduleId: res.scheduleId! });
      return page.items.length >= 1;
    });
    const page = await h.pq.getJobs({ scheduleId: res.scheduleId! });
    expect(page.items[0]!.scheduleId).toBe(res.scheduleId);
  });

  it('carries per-job options (expireInSeconds) from a recurring add onto every spawned job', async () => {
    h.pq.createQueue({ name: 'carry' });
    // No worker: a produced run just sits until it expires. The recurring add sets
    // expireInSeconds, which must ride along and apply to each spawned job (relative to its own
    // fire time). Without carry-through the produced job would have no deadline and never expire.
    const res = await h.pq.addJob({
      queue: 'carry',
      data: {},
      schedule: { startEverySeconds: 1 },
      expireInSeconds: 1,
    });

    // Fire the first run.
    h.clock.advance(1500);
    let jobId = '';
    await waitFor(async () => {
      const page = await h.pq.getJobs({ scheduleId: res.scheduleId! });
      if (page.items[0]) jobId = page.items[0].id;
      return page.items.length >= 1;
    });

    // Push past the produced job's 1-second deadline; the maintenance tick expires it.
    h.clock.advance(2000);
    await waitFor(async () => (await h.pq.getJob({ jobId }))?.status === JobStatus.EXPIRED);
    expect((await h.pq.getJob({ jobId }))!.status).toBe(JobStatus.EXPIRED);
  });

  it('lists schedules and removes them', async () => {
    h.pq.createQueue({ name: 'sched' });
    const res = await h.pq.addJob({ queue: 'sched', data: {}, schedule: { cron: '0 0 * * *' } });
    let schedules = await h.pq.getSchedules({ queue: 'sched' });
    expect(schedules.total).toBe(1);
    expect(schedules.items[0]!.cron).toBe('0 0 * * *');
    expect(schedules.items[0]!.queue).toBe('sched');

    const removed = await h.pq.removeSchedule({ scheduleId: res.scheduleId! });
    expect(removed).toBe(true);
    schedules = await h.pq.getSchedules({ queue: 'sched' });
    expect(schedules.total).toBe(0);
    // Removing it again is `false`, not an error.
    expect(await h.pq.removeSchedule({ scheduleId: res.scheduleId! })).toBe(false);
  });

  it('does not create a queue as a side effect of listing its schedules', async () => {
    // A read that writes is a trap: `getSchedules` used to ensure the queue row first, so asking
    // about a name nothing had used brought that queue into existence.
    const page = await h.pq.getSchedules({ queue: 'never-used' });
    expect(page.total).toBe(0);
    expect(await h.driver.getQueueByName({ name: 'never-used' })).toBeNull();
  });

  it('pages schedules by offset, reports the filter total, and narrows by enabled', async () => {
    h.pq.createQueue({ name: 'sched-paged' });
    for (let i = 0; i < 5; i += 1) {
      await h.pq.addJob({
        queue: 'sched-paged',
        data: { i },
        schedule: { cron: `${i} 0 * * *` },
      });
    }

    const page1 = await h.pq.getSchedules({ queue: 'sched-paged', limit: 2, offset: 0 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5); // the total ignores the window

    const last = await h.pq.getSchedules({ queue: 'sched-paged', limit: 2, offset: 4 });
    expect(last.items).toHaveLength(1);
    expect(last.total).toBe(5);
    const firstIds = page1.items.map((s) => s.scheduleId);
    expect(last.items.every((s) => !firstIds.includes(s.scheduleId))).toBe(true);

    // `enabled` narrows both the page and the total, not just the rows on it.
    expect((await h.pq.getSchedules({ queue: 'sched-paged', enabled: true })).total).toBe(5);
    expect((await h.pq.getSchedules({ queue: 'sched-paged', enabled: false })).total).toBe(0);

    // The singular read is by id alone and carries the queue it belongs to.
    const one = page1.items[0]!;
    const fetched = await h.pq.getSchedule({ scheduleId: one.scheduleId });
    expect(fetched?.cron).toBe(one.cron);
    expect(fetched?.queue).toBe('sched-paged');
    expect(await h.pq.getSchedule({ scheduleId: 'nope' })).toBeNull();
  });

  it('lists schedules across every queue when none is named', async () => {
    h.pq.createQueue({ name: 'cross-a' });
    h.pq.createQueue({ name: 'cross-b' });
    await h.pq.addJob({ queue: 'cross-a', data: {}, schedule: { cron: '0 1 * * *' } });
    await h.pq.addJob({ queue: 'cross-b', data: {}, schedule: { cron: '0 2 * * *' } });
    const all = await h.pq.getSchedules();
    expect(all.total).toBe(2);
    expect(all.items.map((s) => s.queue).sort()).toEqual(['cross-a', 'cross-b']);
  });

  it('allows identical recurrences on a queue to coexist (no dedup without a key)', async () => {
    h.pq.createQueue({ name: 'sched-dup' });
    const a = await h.pq.addJob({
      queue: 'sched-dup',
      data: { n: 1 },
      schedule: { cron: '0 0 * * *' },
    });
    const b = await h.pq.addJob({
      queue: 'sched-dup',
      data: { n: 2 },
      schedule: { cron: '0 0 * * *' },
    });
    expect(b.scheduleId).not.toBe(a.scheduleId);
    expect(b.deduplicated).toBe(false);
    expect((await h.pq.getSchedules({ queue: 'sched-dup' })).total).toBe(2);
  });

  it('deduplicates schedules by idempotency key (keeps the first, unchanged)', async () => {
    h.pq.createQueue({ name: 'sched-idem' });
    const a = await h.pq.addJob({
      queue: 'sched-idem',
      data: { n: 1 },
      schedule: { cron: '0 0 * * *' },
      idempotencyKey: 'daily',
    });
    const b = await h.pq.addJob({
      queue: 'sched-idem',
      data: { n: 2 },
      schedule: { cron: '0 0 * * *' },
      idempotencyKey: 'daily',
    });
    expect(b.deduplicated).toBe(true);
    expect(b.scheduleId).toBe(a.scheduleId);
    const schedules = await h.pq.getSchedules({ queue: 'sched-idem' });
    expect(schedules.total).toBe(1);
    expect(schedules.items[0]!.idempotencyKey).toBe('daily');
  });

  it('idempotency key dedups per table — one-off and recurring keys are independent', async () => {
    h.pq.createQueue({ name: 'sched-cross' });
    // A one-off add only checks the jobs table.
    const job = await h.pq.addJob({ queue: 'sched-cross', data: {}, idempotencyKey: 'shared' });
    // A recurring add with the same key checks only the schedule table, so it is NOT deduped
    // against the existing one-off job — it creates its own schedule.
    const sched = await h.pq.addJob({
      queue: 'sched-cross',
      data: {},
      schedule: { cron: '0 0 * * *' },
      idempotencyKey: 'shared',
    });
    expect(sched.deduplicated).toBe(false);
    expect(sched.scheduleId).toBeTruthy();
    expect(sched.jobId).toBeUndefined();
    expect((await h.pq.getSchedules({ queue: 'sched-cross' })).total).toBe(1);

    // A second one-off add with that key dedups against the existing job (jobs table only).
    const dupJob = await h.pq.addJob({ queue: 'sched-cross', data: {}, idempotencyKey: 'shared' });
    expect(dupJob.deduplicated).toBe(true);
    expect(dupJob.jobId).toBe(job.jobId);
    expect(dupJob.scheduleId).toBeUndefined();

    // A second recurring add with that key dedups against the existing schedule (schedule table only).
    const dupSched = await h.pq.addJob({
      queue: 'sched-cross',
      data: {},
      schedule: { cron: '0 0 * * *' },
      idempotencyKey: 'shared',
    });
    expect(dupSched.deduplicated).toBe(true);
    expect(dupSched.scheduleId).toBe(sched.scheduleId);
    expect((await h.pq.getSchedules({ queue: 'sched-cross' })).total).toBe(1);
  });

  it('deletes finished jobs after their retention TTL elapses', async () => {
    h.pq.createQueue({ name: 'ephemeral' });
    h.pq.createWorker({ queue: 'ephemeral', handler: async () => 'done' });
    const res = await h.pq.addJob({
      queue: 'ephemeral',
      data: {},
      retention: {
        mode: RetentionMode.DELETE_AFTER,
        ttlSeconds: 1,
        statuses: [JobStatus.COMPLETED],
      },
    });
    await waitFor(
      async () => (await h.pq.getJob({ jobId: res.jobId! }))?.status === JobStatus.COMPLETED,
    );

    // Before the TTL elapses the job is retained.
    expect(await h.pq.getJob({ jobId: res.jobId! })).not.toBeNull();

    // Advance past the TTL; the retention sweep (maintenance tick) removes it.
    h.clock.advance(5000);
    await waitFor(async () => (await h.pq.getJob({ jobId: res.jobId! })) === null);
  });

  it('fires more due schedules than one batch holds without waiting for the next tick', async () => {
    // The scheduler batches at 100 and loops until a batch comes back short. Without the loop the
    // 101st due schedule would sit idle for a whole tick interval.
    h.pq.createQueue({ name: 'many' });
    for (let i = 0; i < 105; i += 1) {
      await h.pq.addJob({ queue: 'many', data: { i }, schedule: { startEverySeconds: 3600 } });
    }
    h.clock.advance(3_600_000 + 1000);
    await waitFor(
      async () => (await h.pq.getJobs({ queue: 'many', limit: 1 })).total >= 105,
      20_000,
    );
    expect((await h.pq.getJobs({ queue: 'many', limit: 1 })).total).toBeGreaterThanOrEqual(105);
  });

  it('rejects an unknown schedule key instead of quietly running the job now', async () => {
    h.pq.createQueue({ name: 'typo' });
    // The old absolute-Date `startAfter` is gone, and `startEvery` never existed without its unit.
    // Dropping either silently would look like the scheduler losing the job.
    await expect(
      h.pq.addJob({ queue: 'typo', data: {}, schedule: { startAfter: new Date() } } as never),
    ).rejects.toThrow(/Unknown 'schedule' option on queue 'typo': 'startAfter'/);
    await expect(
      h.pq.addJob({ queue: 'typo', data: {}, schedule: { startEvery: 30 } } as never),
    ).rejects.toThrow(/Unknown 'schedule' option on queue 'typo': 'startEvery'/);
  });

  it('refuses a one-off delay combined with a recurring cadence', async () => {
    h.pq.createQueue({ name: 'both' });
    await expect(
      h.pq.addJob({
        queue: 'both',
        data: {},
        schedule: { startAfterSeconds: 5, startEverySeconds: 10 },
      }),
    ).rejects.toThrow(/Cannot combine 'schedule.startAfterSeconds'/);
  });
});
