import { createTestQueue, waitFor, type TestQueueHandle } from '../test-utils/create-test-queue';
import { JobStatus } from '../jobs/job-state.enum';
import { PortQueueEvent } from '../events/event-name.enum';
import { BatchItemOutcome, PauseMode } from '../options/enums';
import { InvalidOptionsError } from '../errors/errors';
import { MAX_BATCH_IDS } from '../constants';

// The plural twins of the by-id admin methods: one item per id, in the order given, and a batch
// that reports what it skipped rather than throwing for it.
describe('batch job, schedule, queue and instance control (sqlite)', () => {
  let h: TestQueueHandle;
  beforeEach(async () => {
    h = await createTestQueue('sqlite');
  });
  afterEach(async () => {
    await h.cleanup();
  });

  const { APPLIED, SIGNALLED, REFUSED, NOT_FOUND } = BatchItemOutcome;

  it('cancels many jobs across queues, reporting refused and unknown ids per item', async () => {
    const a = await h.pq.addJob({ queue: 'a', data: {} });
    const b = await h.pq.addJob({ queue: 'b', data: {} });
    const done = await h.pq.addJob({ queue: 'a', data: {} });
    await h.pq.cancelJob({ jobId: done.jobId! });
    const cancelled: string[] = [];
    h.pq.on(PortQueueEvent.JOB_CANCELLED, (e) => cancelled.push(e.jobId));

    const items = await h.pq.cancelJobs({ jobIds: [b.jobId!, 'ghost', done.jobId!, a.jobId!] });
    expect(items).toEqual([
      { jobId: b.jobId, queue: 'b', outcome: APPLIED },
      { jobId: 'ghost', outcome: NOT_FOUND },
      { jobId: done.jobId, queue: 'a', outcome: REFUSED },
      { jobId: a.jobId, queue: 'a', outcome: APPLIED },
    ]);
    expect(cancelled.sort()).toEqual([a.jobId, b.jobId].sort());
    expect((await h.pq.getJob({ jobId: a.jobId! }))?.status).toBe(JobStatus.CANCELLED);
  });

  it('signals a job running here instead of cancelling its row', async () => {
    let aborted = false;
    h.pq.createQueue({
      name: 'coop',
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
    expect(await h.pq.cancelJobs({ jobIds: [res.jobId!] })).toEqual([
      { jobId: res.jobId, outcome: SIGNALLED },
    ]);
    await waitFor(() => aborted);
  });

  it('retries many settled jobs and refuses a running one', async () => {
    const settled = await h.pq.addJob({ queue: 'r', data: {} });
    await h.pq.cancelJob({ jobId: settled.jobId! });
    h.pq.createQueue({
      name: 'busy',
      limiter: { pollIntervalSeconds: 0.02 },
      handler: (job) =>
        new Promise<void>((resolve) => job.signal.addEventListener('abort', () => resolve())),
    });
    const running = await h.pq.addJob({ queue: 'busy', data: {} });
    await waitFor(
      async () => (await h.pq.getJob({ jobId: running.jobId! }))?.status === JobStatus.ACTIVE,
    );

    const items = await h.pq.retryJobs({ jobIds: [settled.jobId!, running.jobId!, 'ghost'] });
    expect(items).toEqual([
      {
        jobId: settled.jobId,
        queue: 'r',
        outcome: APPLIED,
        status: JobStatus.PENDING,
        startAfter: expect.any(Date),
      },
      { jobId: running.jobId, queue: 'busy', outcome: REFUSED },
      { jobId: 'ghost', outcome: NOT_FOUND },
    ]);
    expect((await h.pq.getJob({ jobId: settled.jobId! }))?.status).toBe(JobStatus.PENDING);
    await h.pq.cancelJob({ jobId: running.jobId! });
  });

  it('removes many schedules, reporting an unknown id as not found', async () => {
    const one = await h.pq.addJob({ queue: 's', data: {}, schedule: { cron: '0 * * * *' } });
    const two = await h.pq.addJob({ queue: 's', data: {}, schedule: { cron: '5 * * * *' } });
    const items = await h.pq.removeSchedules({
      scheduleIds: [one.scheduleId!, 'ghost', two.scheduleId!],
    });
    expect(items).toEqual([
      { scheduleId: one.scheduleId, queue: 's', outcome: APPLIED },
      { scheduleId: 'ghost', outcome: NOT_FOUND },
      { scheduleId: two.scheduleId, queue: 's', outcome: APPLIED },
    ]);
    expect(await h.pq.getSchedule({ scheduleId: one.scheduleId! })).toBeNull();
  });

  it('pauses and resumes many queues, reporting an unknown name instead of throwing', async () => {
    await h.pq.addJob({ queue: 'q1', data: {} });
    await h.pq.addJob({ queue: 'q2', data: {} });
    const paused: string[] = [];
    h.pq.on(PortQueueEvent.QUEUE_PAUSED, (e) => paused.push(e.queue));

    expect(await h.pq.pauseQueues({ queues: ['q1', 'ghost', 'q2'], mode: PauseMode.ALL })).toEqual(
      [
        { queue: 'q1', outcome: APPLIED },
        { queue: 'ghost', outcome: NOT_FOUND },
        { queue: 'q2', outcome: APPLIED },
      ],
    );
    expect(paused.sort()).toEqual(['q1', 'q2']);
    expect(await h.pq.getQueue({ name: 'q2' })).toMatchObject({
      processingPaused: true,
      acceptingPaused: true,
    });

    expect(await h.pq.resumeQueues({ queues: ['q2'] })).toEqual([{ queue: 'q2', outcome: APPLIED }]);
    expect(await h.pq.getQueue({ name: 'q2' })).toMatchObject({
      processingPaused: false,
      acceptingPaused: false,
    });
  });

  it('pauses, resumes and removes many instances with per-key outcomes', async () => {
    await h.driver.upsertInstance({ instanceKey: 'old', now: h.clock.now() });
    h.clock.advance(31 * 60_000);
    await h.driver.upsertInstance({ instanceKey: 'fresh', now: h.clock.now() });

    expect(await h.pq.pauseInstances({ instanceKeys: ['old', 'fresh', 'ghost'] })).toEqual([
      { instanceKey: 'old', outcome: APPLIED },
      { instanceKey: 'fresh', outcome: APPLIED },
      { instanceKey: 'ghost', outcome: NOT_FOUND },
    ]);
    expect(await h.pq.getInstance({ instanceKey: 'fresh' })).toMatchObject({
      processingPaused: true,
    });
    expect(await h.pq.resumeInstances({ instanceKeys: ['fresh'] })).toEqual([
      { instanceKey: 'fresh', outcome: APPLIED },
    ]);

    // A recently-seen instance is refused rather than thrown for, so the stale one still goes.
    expect(await h.pq.removeInstances({ instanceKeys: ['fresh', 'old', 'ghost'] })).toEqual([
      { instanceKey: 'fresh', outcome: REFUSED },
      { instanceKey: 'old', outcome: APPLIED },
      { instanceKey: 'ghost', outcome: NOT_FOUND },
    ]);
    expect(await h.pq.getInstance({ instanceKey: 'old' })).toBeNull();
    expect(await h.pq.getInstance({ instanceKey: 'fresh' })).not.toBeNull();
  });

  it('answers an empty batch with an empty result and rejects one past the id cap', async () => {
    expect(await h.pq.cancelJobs({ jobIds: [] })).toEqual([]);
    expect(await h.pq.pauseQueues({ queues: [] })).toEqual([]);
    const tooMany = Array.from({ length: MAX_BATCH_IDS + 1 }, (_, i) => `id-${i}`);
    await expect(h.pq.retryJobs({ jobIds: tooMany })).rejects.toThrow(InvalidOptionsError);
    await expect(h.pq.removeInstances({ instanceKeys: tooMany })).rejects.toThrow(
      InvalidOptionsError,
    );
  });
});
