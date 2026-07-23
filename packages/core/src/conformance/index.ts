import { DriverContext } from '../driver/driver-context.js';
import { MIGRATIONS } from '../schema/migration/migrations/index.js';
import { JobStatus } from '../jobs/job-state.enum.js';
import { BackoffStrategy, RetentionMode } from '../options/enums.js';
import { DriverCapability } from '../driver/driver-capabilities.js';
import type { Driver } from '../driver/driver.interface.js';
import type { NewJobRecord } from '../jobs/job-record.js';

/**
 * Driver conformance kit. A parameterized suite that takes a `Driver`
 * factory and asserts the contract (claim atomicity, ordering, visibility timeout, insert
 * semantics, tool-managed idempotency, transactional enqueue, schedule upsert idempotency,
 * instance-affinity claiming, and instance liveness). Shipped from `@portqueue/core/conformance`
 * so custom-driver authors validate the same way.
 */
export interface ConformanceOptions {
  name: string;
  createDriver: () => Driver;
}

const QUEUE = 'conformance';

async function bootstrap(driver: Driver): Promise<{ queueName: string; context: DriverContext }> {
  const context = new DriverContext({ tablePrefix: 'pq_' });
  (driver as unknown as { setContext?: (c: DriverContext) => void }).setContext?.(context);
  await driver.connect();
  await driver.ensureBaseObjects({ context });
  for (const migration of MIGRATIONS) await driver.applyMigration({ migration });
  const queue = await driver.ensureQueue({ name: QUEUE, now: Date.now() });
  return { queueName: queue.name, context };
}

function newJob(
  queueName: string,
  now: number,
  overrides: Partial<NewJobRecord> = {},
): NewJobRecord {
  return {
    queueName,
    status: JobStatus.PENDING,
    priority: 0,
    data: { hello: 'world' },
    metadata: {},
    startAfter: now,
    expireAt: null,
    retryAttempt: 0,
    retryMaxAttempts: 3,
    retryDelayMs: 100,
    retryBackoff: BackoffStrategy.FIXED,
    retryBackoffFactor: null,
    retryMaxDelayMs: null,
    retryJitter: false,
    retentionMode: RetentionMode.KEEP_FOREVER,
    retentionTtlMs: null,
    idempotencyKey: null,
    scheduleId: null,
    singletonKey: null,
    workflowId: null,
    workflowStepKey: null,
    preferredInstanceKey: null,
    preferredInstanceKeyPattern: null,
    fallbackInstanceKey: null,
    fallbackInstanceKeyPattern: null,
    createdAt: now,
    ...overrides,
  };
}

/** Register the conformance suite in a jest context. */
export function runConformance(options: ConformanceOptions): void {
  describe(`driver conformance: ${options.name}`, () => {
    let driver: Driver;
    let queueName: string;
    const now = 1_700_000_000_000;

    beforeEach(async () => {
      driver = options.createDriver();
      ({ queueName } = await bootstrap(driver));
    });
    afterEach(async () => {
      await driver.disconnect();
    });

    it('inserts a job and returns a structured row', async () => {
      const inserted = await driver.insertJob({ job: newJob(queueName, now) });
      expect(inserted.id).toBeTruthy();
      expect(inserted.status).toBe(JobStatus.PENDING);
      expect(inserted.deduplicated).toBe(false);
    });

    it('claims due jobs in priority then start_after order', async () => {
      await driver.insertJob({ job: newJob(queueName, now, { priority: 1, data: { n: 1 } }) });
      await driver.insertJob({ job: newJob(queueName, now, { priority: 5, data: { n: 2 } }) });
      const claimed = await driver.claimJobs({
        queueName,
        limit: 10,
        lockDurationMs: 30000,
        now: now + 1,
        lockedByInstanceId: 'i1',
      });
      expect(claimed).toHaveLength(2);
      expect((claimed[0]!.data as { n: number }).n).toBe(2); // higher priority first
      expect(claimed.every((j) => j.status === JobStatus.ACTIVE)).toBe(true);
    });

    it('never double-claims a job under concurrent claims', async () => {
      for (let i = 0; i < 20; i += 1)
        await driver.insertJob({ job: newJob(queueName, now, { data: { i } }) });
      const claimOnce = () =>
        driver.claimJobs({
          queueName,
          limit: 20,
          lockDurationMs: 30000,
          now: now + 1,
          lockedByInstanceId: 'x',
        });
      const [a, b] = await Promise.all([claimOnce(), claimOnce()]);
      const ids = new Set([...a, ...b].map((j) => j.id));
      expect(ids.size).toBe(a.length + b.length); // no overlap
      expect(a.length + b.length).toBe(20);
    });

    it('does not claim delayed jobs before start_after', async () => {
      await driver.insertJob({ job: newJob(queueName, now, { startAfter: now + 60000 }) });
      const claimed = await driver.claimJobs({
        queueName,
        limit: 10,
        lockDurationMs: 30000,
        now: now + 1,
        lockedByInstanceId: 'i',
      });
      expect(claimed).toHaveLength(0);
    });

    it('completes a job', async () => {
      const inserted = await driver.insertJob({ job: newJob(queueName, now) });
      await driver.claimJobs({
        queueName,
        limit: 1,
        lockDurationMs: 30000,
        now: now + 1,
        lockedByInstanceId: 'i',
      });
      await driver.completeJob({ jobId: inserted.id, returnValue: { ok: true }, now: now + 2 });
      const record = await driver.getJob({ jobId: inserted.id });
      expect(record?.status).toBe(JobStatus.COMPLETED);
      expect(record?.returnValue).toEqual({ ok: true });
    });

    it('reclaims stalled jobs after the visibility timeout', async () => {
      const inserted = await driver.insertJob({ job: newJob(queueName, now) });
      await driver.claimJobs({
        queueName,
        limit: 1,
        lockDurationMs: 1000,
        now,
        lockedByInstanceId: 'i',
      });
      const reclaimed = await driver.reclaimStalledJobs({ now: now + 5000 });
      expect(reclaimed.map((j) => j.id)).toContain(inserted.id);
      const record = await driver.getJob({ jobId: inserted.id });
      expect(record?.status).toBe(JobStatus.PENDING);
    });

    it('enforces idempotency in-tool (returns the existing job)', async () => {
      const a = await driver.insertJob({ job: newJob(queueName, now, { idempotencyKey: 'k1' }) });
      const b = await driver.insertJob({ job: newJob(queueName, now, { idempotencyKey: 'k1' }) });
      expect(b.deduplicated).toBe(true);
      expect(b.id).toBe(a.id);
      expect(b.deduplicationReason).toBe('IDEMPOTENCY');
    });

    it('allows identical schedules to coexist and dedups by idempotency key', async () => {
      const base = {
        queueName,
        cron: '0 0 * * *',
        everyMs: null,
        timezone: 'UTC',
        data: {},
        priority: null,
        retryMaxAttempts: null,
        retryDelayMs: null,
        nextRunAt: now + 1000,
        enabled: true,
        startAt: null,
        endAt: null,
        idempotencyKey: null,
      };
      // No pattern-based dedup: two identical recurrences are two distinct schedule rows.
      const first = await driver.insertSchedule({ schedule: base });
      const second = await driver.insertSchedule({ schedule: { ...base, nextRunAt: now + 2000 } });
      expect(second.id).not.toBe(first.id);
      expect(await driver.listSchedules({ queueName })).toHaveLength(2);

      // The idempotency key is the opt-in dedup token; it's looked up per queue.
      const keyed = await driver.insertSchedule({ schedule: { ...base, idempotencyKey: 'sk' } });
      const found = await driver.findScheduleByIdempotencyKey({
        queueName,
        idempotencyKey: 'sk',
      });
      expect(found?.id).toBe(keyed.id);
      expect(await driver.findScheduleByIdempotencyKey({ queueName, idempotencyKey: 'nope' })).toBe(
        null,
      );
    });

    it('advances a workflow step atomically (complete-this + spawn-next)', async () => {
      const wfId = 'wf-1';
      const first = await driver.insertJob({
        job: newJob(queueName, now, { workflowId: wfId, workflowStepKey: 'a' }),
      });
      const spawned = await driver.advanceWorkflowStep({
        jobId: first.id,
        returnValue: { step: 'a' },
        now: now + 1,
        spawn: newJob(queueName, now + 1, {
          workflowId: wfId,
          workflowStepKey: 'b',
          data: { from: 'a' },
        }),
      });
      expect(spawned?.status).toBe(JobStatus.PENDING);
      const firstRecord = await driver.getJob({ jobId: first.id });
      expect(firstRecord?.status).toBe(JobStatus.COMPLETED);
      const runJobs = await driver.getJobs({
        workflowId: wfId,
        limit: 10,
        offset: 0,
        order: 'asc',
      });
      expect(runJobs).toHaveLength(2);
    });

    it('enqueues transactionally (commit persists, rollback discards)', async () => {
      if (!driver.capabilities[DriverCapability.TRANSACTIONS]) return;
      // Commit path via the internal transaction machinery.
      await driver.runInTransaction({
        fn: async (tx) => {
          await driver.insertJob({
            job: newJob(queueName, now, { idempotencyKey: 'tx-commit' }),
            tx,
          });
        },
      });
      const committed = await driver.getJobs({
        queueName,
        statuses: [JobStatus.PENDING],
        limit: 100,
        offset: 0,
        order: 'asc',
      });
      expect(committed.some((j) => j.idempotencyKey === 'tx-commit')).toBe(true);

      // Rollback path.
      await driver
        .runInTransaction({
          fn: async (tx) => {
            await driver.insertJob({
              job: newJob(queueName, now, { idempotencyKey: 'tx-rollback' }),
              tx,
            });
            throw new Error('rollback');
          },
        })
        .catch(() => undefined);
      const after = await driver.getJobs({ queueName, limit: 100, offset: 0, order: 'asc' });
      expect(after.some((j) => j.idempotencyKey === 'tx-rollback')).toBe(false);
    });

    // --- Multi-instance ---

    it('registers an instance and lists it with liveness fields', async () => {
      const row = await driver.upsertInstance({ instanceKey: 'inst-a', now });
      expect(row.instanceKey).toBe('inst-a');
      expect(row.processingPaused).toBe(false);
      const list = await driver.listInstances();
      expect(list.map((i) => i.instanceKey)).toContain('inst-a');
      // A second upsert heartbeats (bumps last_seen_at), never duplicating the row.
      await driver.upsertInstance({ instanceKey: 'inst-a', now: now + 1000 });
      const again = await driver.listInstances();
      expect(again.filter((i) => i.instanceKey === 'inst-a')).toHaveLength(1);
      expect(again.find((i) => i.instanceKey === 'inst-a')!.lastSeenAt).toBe(now + 1000);
    });

    it('pauses and resumes a single instance', async () => {
      await driver.upsertInstance({ instanceKey: 'inst-b', now });
      await driver.setInstancePaused({ instanceKey: 'inst-b', processingPaused: true, now });
      expect((await driver.getInstance({ instanceKey: 'inst-b' }))?.processingPaused).toBe(true);
      // A heartbeat must not clear the pause flag.
      await driver.upsertInstance({ instanceKey: 'inst-b', now: now + 500 });
      expect((await driver.getInstance({ instanceKey: 'inst-b' }))?.processingPaused).toBe(true);
      await driver.setInstancePaused({ instanceKey: 'inst-b', processingPaused: false, now });
      expect((await driver.getInstance({ instanceKey: 'inst-b' }))?.processingPaused).toBe(false);
    });

    it('honours preferred-instance affinity when the preferred instance is alive', async () => {
      await driver.insertJob({
        job: newJob(queueName, now, { data: { pin: 'a' }, preferredInstanceKey: 'inst-a' }),
      });
      // inst-b must not claim a job preferred to (still-alive) inst-a.
      const bClaim = await driver.claimJobs({
        queueName,
        limit: 10,
        lockDurationMs: 30000,
        now: now + 1,
        lockedByInstanceId: 'b',
        instanceKey: 'inst-b',
        aliveInstanceKeys: ['inst-a', 'inst-b'],
      });
      expect(bClaim).toHaveLength(0);
      // inst-a claims it and is recorded as the processor.
      const aClaim = await driver.claimJobs({
        queueName,
        limit: 10,
        lockDurationMs: 30000,
        now: now + 2,
        lockedByInstanceId: 'a',
        instanceKey: 'inst-a',
        aliveInstanceKeys: ['inst-a', 'inst-b'],
      });
      expect(aClaim).toHaveLength(1);
      expect(aClaim[0]!.processedOnInstanceKey).toBe('inst-a');
    });

    it('falls back to another instance when the preferred instance is dead', async () => {
      await driver.insertJob({
        job: newJob(queueName, now, { preferredInstanceKey: 'inst-dead' }),
      });
      // inst-dead is absent from the alive set → inst-b may rescue the job.
      const claim = await driver.claimJobs({
        queueName,
        limit: 10,
        lockDurationMs: 30000,
        now: now + 1,
        lockedByInstanceId: 'b',
        instanceKey: 'inst-b',
        aliveInstanceKeys: ['inst-b'],
      });
      expect(claim).toHaveLength(1);
    });

    it('matches a preferred-instance-key regex pattern', async () => {
      await driver.insertJob({
        job: newJob(queueName, now, { preferredInstanceKeyPattern: '^worker-eu-' }),
      });
      // A non-matching instance leaves it for a matching one.
      const us = await driver.claimJobs({
        queueName,
        limit: 10,
        lockDurationMs: 30000,
        now: now + 1,
        lockedByInstanceId: 'us',
        instanceKey: 'worker-us-1',
        aliveInstanceKeys: ['worker-us-1', 'worker-eu-1'],
      });
      expect(us).toHaveLength(0);
      const eu = await driver.claimJobs({
        queueName,
        limit: 10,
        lockDurationMs: 30000,
        now: now + 2,
        lockedByInstanceId: 'eu',
        instanceKey: 'worker-eu-1',
        aliveInstanceKeys: ['worker-us-1', 'worker-eu-1'],
      });
      expect(eu).toHaveLength(1);
    });
  });
}
