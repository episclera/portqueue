import {
  createTestQueue,
  TEST_ENGINES,
  waitFor,
  type TestQueueHandle,
} from '../test-utils/create-test-queue.js';
import { JobStatus } from '../jobs/job-state.enum.js';
import { RetentionMode } from '../options/enums.js';

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
