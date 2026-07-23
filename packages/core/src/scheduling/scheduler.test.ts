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
      startEvery: 1000,
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

  it('lists schedules and removes them', async () => {
    const queue = h.pq.createQueue('sched');
    const res = await queue.addJob({ data: {}, cron: '0 0 * * *' });
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
    const a = await queue.addJob({ data: { n: 1 }, cron: '0 0 * * *' });
    const b = await queue.addJob({ data: { n: 2 }, cron: '0 0 * * *' });
    expect(b.scheduleId).not.toBe(a.scheduleId);
    expect(b.deduplicated).toBe(false);
    expect(await queue.getSchedules()).toHaveLength(2);
  });

  it('deduplicates schedules by idempotency key (keeps the first, unchanged)', async () => {
    const queue = h.pq.createQueue('sched-idem');
    const a = await queue.addJob({ data: { n: 1 }, cron: '0 0 * * *', idempotencyKey: 'daily' });
    const b = await queue.addJob({ data: { n: 2 }, cron: '0 0 * * *', idempotencyKey: 'daily' });
    expect(b.deduplicated).toBe(true);
    expect(b.scheduleId).toBe(a.scheduleId);
    const schedules = await queue.getSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]!.idempotencyKey).toBe('daily');
  });

  it('idempotency key dedups across the job and schedule tables', async () => {
    const queue = h.pq.createQueue('sched-cross');
    // A one-off job claims the key first.
    const job = await queue.addJob({ data: {}, idempotencyKey: 'shared' });
    // A later recurring add with the same key is deduped against the existing job, not created.
    const sched = await queue.addJob({ data: {}, cron: '0 0 * * *', idempotencyKey: 'shared' });
    expect(sched.deduplicated).toBe(true);
    expect(sched.jobId).toBe(job.jobId);
    expect(sched.scheduleId).toBeUndefined();
    expect(await queue.getSchedules()).toHaveLength(0);

    // And the reverse: a schedule's key blocks a plain one-off add carrying the same key.
    const other = h.pq.createQueue('sched-cross-2');
    const s = await other.addJob({ data: {}, startEvery: 1000, idempotencyKey: 'k2' });
    const dupJob = await other.addJob({ data: {}, idempotencyKey: 'k2' });
    expect(dupJob.deduplicated).toBe(true);
    expect(dupJob.scheduleId).toBe(s.scheduleId);
    expect(dupJob.jobId).toBeUndefined();
  });

  it('deletes finished jobs after their retention TTL elapses', async () => {
    const queue = h.pq.createQueue('ephemeral');
    h.pq.createWorker({ queue: 'ephemeral', handler: async () => 'done' });
    const res = await queue.addJob({
      data: {},
      retention: { mode: RetentionMode.DELETE_AFTER, ttl: 1000, statuses: [JobStatus.COMPLETED] },
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
});
