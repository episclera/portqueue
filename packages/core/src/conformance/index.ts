import { DriverContext } from '../driver/driver-context.js';
import { MIGRATIONS } from '../schema/migration/migrations/index.js';
import { JobStatus } from '../jobs/job-state.enum.js';
import { BackoffStrategy, RetentionMode, InstanceType } from '../options/enums.js';
import { DriverCapability } from '../driver/driver-capabilities.js';
import type { Driver } from '../driver/driver.interface.js';
import type { NewJobRecord } from '../jobs/job-record.js';

/**
 * Driver conformance kit (build_plan/16.6). A parameterized suite that takes a `Driver`
 * factory and asserts the contract (claim atomicity, ordering, visibility timeout, insert
 * semantics, idempotency, transactional enqueue, schedule upsert idempotency). Shipped from
 * `@portqueue/core/conformance` so custom-driver authors validate the same way.
 */
export interface ConformanceOptions {
  name: string;
  createDriver: () => Driver;
}

async function bootstrap(driver: Driver): Promise<{ queueId: string; context: DriverContext }> {
  const context = new DriverContext({ tablePrefix: 'pq_' });
  (driver as unknown as { setContext?: (c: DriverContext) => void }).setContext?.(context);
  await driver.connect();
  await driver.ensureBaseObjects({ context });
  for (const migration of MIGRATIONS) await driver.applyMigration({ migration });
  const queue = await driver.ensureQueue({ name: 'conformance', now: Date.now() });
  return { queueId: queue.id, context };
}

function newJob(queueId: string, now: number, overrides: Partial<NewJobRecord> = {}): NewJobRecord {
  return {
    queueId,
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
    runOnInstanceId: null,
    runOnInstanceType: InstanceType.UNKNOWN,
    createdAt: now,
    ...overrides,
  };
}

/** Register the conformance suite in a jest context. */
export function runConformance(options: ConformanceOptions): void {
  describe(`driver conformance: ${options.name}`, () => {
    let driver: Driver;
    let queueId: string;
    const now = 1_700_000_000_000;

    beforeEach(async () => {
      driver = options.createDriver();
      ({ queueId } = await bootstrap(driver));
    });
    afterEach(async () => {
      await driver.disconnect();
    });

    it('inserts a job and returns a structured row', async () => {
      const inserted = await driver.insertJob({ job: newJob(queueId, now) });
      expect(inserted.id).toBeTruthy();
      expect(inserted.status).toBe(JobStatus.PENDING);
      expect(inserted.deduplicated).toBe(false);
    });

    it('claims due jobs in priority then start_after order', async () => {
      await driver.insertJob({ job: newJob(queueId, now, { priority: 1, data: { n: 1 } }) });
      await driver.insertJob({ job: newJob(queueId, now, { priority: 5, data: { n: 2 } }) });
      const claimed = await driver.claimJobs({
        queueId,
        limit: 10,
        lockDurationMs: 30000,
        now: now + 1,
        instanceId: 'i1',
        instanceType: 'UNKNOWN',
      });
      expect(claimed).toHaveLength(2);
      expect((claimed[0]!.data as { n: number }).n).toBe(2); // higher priority first
      expect(claimed.every((j) => j.status === JobStatus.ACTIVE)).toBe(true);
    });

    it('never double-claims a job under concurrent claims', async () => {
      for (let i = 0; i < 20; i += 1)
        await driver.insertJob({ job: newJob(queueId, now, { data: { i } }) });
      const claimOnce = () =>
        driver.claimJobs({
          queueId,
          limit: 20,
          lockDurationMs: 30000,
          now: now + 1,
          instanceId: 'x',
          instanceType: 'UNKNOWN',
        });
      const [a, b] = await Promise.all([claimOnce(), claimOnce()]);
      const ids = new Set([...a, ...b].map((j) => j.id));
      expect(ids.size).toBe(a.length + b.length); // no overlap
      expect(a.length + b.length).toBe(20);
    });

    it('does not claim delayed jobs before start_after', async () => {
      await driver.insertJob({ job: newJob(queueId, now, { startAfter: now + 60000 }) });
      const claimed = await driver.claimJobs({
        queueId,
        limit: 10,
        lockDurationMs: 30000,
        now: now + 1,
        instanceId: 'i',
        instanceType: 'UNKNOWN',
      });
      expect(claimed).toHaveLength(0);
    });

    it('completes a job', async () => {
      const inserted = await driver.insertJob({ job: newJob(queueId, now) });
      await driver.claimJobs({
        queueId,
        limit: 1,
        lockDurationMs: 30000,
        now: now + 1,
        instanceId: 'i',
        instanceType: 'UNKNOWN',
      });
      await driver.completeJob({ jobId: inserted.id, returnValue: { ok: true }, now: now + 2 });
      const record = await driver.getJob({ jobId: inserted.id });
      expect(record?.status).toBe(JobStatus.COMPLETED);
      expect(record?.returnValue).toEqual({ ok: true });
    });

    it('reclaims stalled jobs after the visibility timeout', async () => {
      const inserted = await driver.insertJob({ job: newJob(queueId, now) });
      await driver.claimJobs({
        queueId,
        limit: 1,
        lockDurationMs: 1000,
        now,
        instanceId: 'i',
        instanceType: 'UNKNOWN',
      });
      const reclaimed = await driver.reclaimStalledJobs({ now: now + 5000 });
      expect(reclaimed.map((j) => j.id)).toContain(inserted.id);
      const record = await driver.getJob({ jobId: inserted.id });
      expect(record?.status).toBe(JobStatus.PENDING);
    });

    it('enforces idempotency via a unique constraint (returns the existing job)', async () => {
      const a = await driver.insertJob({ job: newJob(queueId, now, { idempotencyKey: 'k1' }) });
      const b = await driver.insertJob({ job: newJob(queueId, now, { idempotencyKey: 'k1' }) });
      expect(b.deduplicated).toBe(true);
      expect(b.id).toBe(a.id);
      expect(b.deduplicationReason).toBe('IDEMPOTENCY');
    });

    it('upserts schedules idempotently on (queue, key)', async () => {
      const base = {
        key: 'daily',
        queueId,
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
      };
      const first = await driver.upsertSchedule({ schedule: base });
      const second = await driver.upsertSchedule({ schedule: { ...base, nextRunAt: now + 2000 } });
      expect(second.id).toBe(first.id);
      const all = await driver.listSchedules({ queueId });
      expect(all).toHaveLength(1);
    });

    it('advances a workflow step atomically (complete-this + spawn-next)', async () => {
      const wfId = 'wf-1';
      const first = await driver.insertJob({
        job: newJob(queueId, now, { workflowId: wfId, workflowStepKey: 'a' }),
      });
      const spawned = await driver.advanceWorkflowStep({
        jobId: first.id,
        returnValue: { step: 'a' },
        now: now + 1,
        spawn: newJob(queueId, now + 1, {
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
            job: newJob(queueId, now, { idempotencyKey: 'tx-commit' }),
            tx,
          });
        },
      });
      const committed = await driver.getJobs({
        queueId,
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
              job: newJob(queueId, now, { idempotencyKey: 'tx-rollback' }),
              tx,
            });
            throw new Error('rollback');
          },
        })
        .catch(() => undefined);
      const after = await driver.getJobs({ queueId, limit: 100, offset: 0, order: 'asc' });
      expect(after.some((j) => j.idempotencyKey === 'tx-rollback')).toBe(false);
    });
  });
}
