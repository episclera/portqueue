import { DriverContext } from '../drivers/driver-context';
import { JobStatus } from '../jobs/job-state.enum';
import { BackoffStrategy } from '../options/enums';
import { DriverCapability } from '../drivers/driver-capabilities';
import { MAX_BATCH_IDS } from '../constants';
import type { Driver } from '../drivers/driver.interface';
import type { NewJobRecord } from '../jobs/job-record';

/**
 * Driver conformance kit. A parameterized suite that takes a `Driver` factory and asserts the
 * contract every driver has to keep — this is the contract, not a smoke test:
 *
 * - **Claiming**: atomicity under concurrent claimers, priority/`start_after` order, the visibility
 *   timeout and its reclaim, instance affinity, and a fresh `lock_token` per claim.
 * - **Settling**: the fence every completion is guarded on — a `completeJob`/`failJob`/`retryJob`
 *   whose claim was lost must be refused rather than overwrite the run that took the row — and
 *   `extendLock` reporting false once a lock has lapsed, which the heartbeat's abort path depends on.
 * - **Producing**: insert semantics, tool-managed idempotency and singleton dedup **including two
 *   concurrent identical adds**, transactional enqueue, schedule dedup.
 * - **Guards core relies on**: `requeueJob`/`removeJob`/`cancelJob` refusing an ACTIVE row, a requeue
 *   clearing every marker of the job's previous life, bounded `expireDueJobs`/`reclaimStalledJobs`,
 *   `deleteFinishedJobs` with per-row retention statuses, `advanceSchedule`'s guarded claim,
 *   `setScheduleEnabled`, the instance reads and their grouped counts.
 * - **Reads**: the `search` filter in SQL, and agreement between every list page and its `count*`.
 * - **Limits**: a batch at the id cap works, and one past it is chunked rather than sent whole.
 *
 * Shipped from `@portqueue/core/conformance` so custom-driver authors validate the same way. PGLite
 * and SQLite run it in CI; MySQL and Oracle are validated with it by hand against a real server — see
 * `packages/core/DRIVER-VERIFICATION.md` for how, and for when each was last run.
 */
export interface ConformanceOptions {
  name: string;
  createDriver: () => Driver;
}

const QUEUE = 'conformance';

async function bootstrap(driver: Driver): Promise<{ queueName: string; context: DriverContext }> {
  await driver.connect();
  for (const migration of driver.migrations) await driver.applyMigration({ migration });
  const queue = await driver.ensureQueue({ name: QUEUE, now: Date.now() });
  return { queueName: queue.name, context: driver.context };
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
    startAfter: now,
    expireAt: null,
    retryAttempt: 0,
    retryMaxAttempts: 3,
    retryDelaySeconds: 1,
    retryBackoff: BackoffStrategy.FIXED,
    retryBackoffFactor: null,
    retryMaxDelaySeconds: null,
    retryJitter: false,
    retentionTtlSeconds: null,
    retentionStatuses: null,
    idempotencyKey: null,
    scheduleId: null,
    singletonKey: null,
    preferredInstanceKeyPattern: null,
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
        lockDurationSeconds: 30,
        now: now + 1,
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
          lockDurationSeconds: 30,
          now: now + 1,
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
        lockDurationSeconds: 30,
        now: now + 1,
      });
      expect(claimed).toHaveLength(0);
    });

    it('completes a job', async () => {
      const inserted = await driver.insertJob({ job: newJob(queueName, now) });
      const [claimed] = await driver.claimJobs({
        queueName,
        limit: 1,
        lockDurationSeconds: 30,
        now: now + 1,
      });
      const settled = await driver.completeJob({
        jobId: inserted.id,
        returnValue: { ok: true },
        now: now + 2,
        lockToken: claimed?.lockToken ?? null,
      });
      expect(settled).toBe(true);
      const record = await driver.getJob({ jobId: inserted.id });
      expect(record?.status).toBe(JobStatus.COMPLETED);
      expect(record?.returnValue).toEqual({ ok: true });
    });

    it('stamps a fresh lock token on every claim', async () => {
      // The token is what fences a completion to the claim that produced it, so two claims of the
      // same row must never share one.
      await driver.insertJob({ job: newJob(queueName, now) });
      const [first] = await driver.claimJobs({
        queueName,
        limit: 1,
        lockDurationSeconds: 1,
        now,
      });
      expect(first?.lockToken).toBeTruthy();
      await driver.reclaimStalledJobs({ now: now + 5000, limit: 10 });
      const [second] = await driver.claimJobs({
        queueName,
        limit: 1,
        lockDurationSeconds: 30,
        now: now + 5001,
      });
      expect(second?.lockToken).toBeTruthy();
      expect(second?.lockToken).not.toBe(first?.lockToken);
    });

    it('refuses a completion after the lock lapsed, rather than overwriting the re-claim', async () => {
      // The double-run bug this closes: a handler that ignored its abort signal finishes after its
      // lock has been reclaimed and a second worker has taken the row. Its outcome must not land.
      const inserted = await driver.insertJob({ job: newJob(queueName, now) });
      const [first] = await driver.claimJobs({
        queueName,
        limit: 1,
        lockDurationSeconds: 1,
        now,
      });
      await driver.reclaimStalledJobs({ now: now + 5000, limit: 10 });
      const [second] = await driver.claimJobs({
        queueName,
        limit: 1,
        lockDurationSeconds: 30,
        now: now + 5001,
      });

      // The first run finishes late and tries to settle the row.
      const stale = await driver.completeJob({
        jobId: inserted.id,
        returnValue: { from: 'first' },
        now: now + 5002,
        lockToken: first?.lockToken ?? null,
      });
      expect(stale).toBe(false);
      const midway = await driver.getJob({ jobId: inserted.id });
      expect(midway?.status).toBe(JobStatus.ACTIVE);
      expect(midway?.returnValue).toBeNull();

      // The claim that actually owns the row still settles it.
      const settled = await driver.completeJob({
        jobId: inserted.id,
        returnValue: { from: 'second' },
        now: now + 5003,
        lockToken: second?.lockToken ?? null,
      });
      expect(settled).toBe(true);
      const finished = await driver.getJob({ jobId: inserted.id });
      expect(finished?.status).toBe(JobStatus.COMPLETED);
      expect(finished?.returnValue).toEqual({ from: 'second' });
    });

    it('refuses to fail or retry a job whose claim was lost', async () => {
      const stale = await driver.insertJob({ job: newJob(queueName, now) });
      const [first] = await driver.claimJobs({ queueName, limit: 1, lockDurationSeconds: 1, now });
      await driver.reclaimStalledJobs({ now: now + 5000, limit: 10 });

      expect(
        await driver.failJob({
          jobId: stale.id,
          lastError: 'late',
          now: now + 5001,
          lockToken: first?.lockToken ?? null,
        }),
      ).toBe(false);
      expect(
        await driver.retryJob({
          jobId: stale.id,
          nextRunAt: now + 6000,
          retryAttempt: 1,
          lastError: 'late',
          now: now + 5001,
          lockToken: first?.lockToken ?? null,
        }),
      ).toBe(false);
      // Still PENDING from the reclaim — neither late write touched it.
      expect((await driver.getJob({ jobId: stale.id }))?.status).toBe(JobStatus.PENDING);
    });

    it('reports false from extendLock once the claim is gone', async () => {
      // The heartbeat's abort path depends on this: a lock it can no longer extend means the job is
      // running elsewhere, and the local handler must be told to stop.
      const inserted = await driver.insertJob({ job: newJob(queueName, now) });
      const [claimed] = await driver.claimJobs({
        queueName,
        limit: 1,
        lockDurationSeconds: 1,
        now,
      });
      expect(
        await driver.extendLock({
          jobId: inserted.id,
          lockDurationSeconds: 30,
          now: now + 1,
          lockToken: claimed?.lockToken ?? null,
        }),
      ).toBe(true);
      await driver.reclaimStalledJobs({ now: now + 60_000, limit: 10 });
      expect(
        await driver.extendLock({
          jobId: inserted.id,
          lockDurationSeconds: 30,
          now: now + 60_001,
          lockToken: claimed?.lockToken ?? null,
        }),
      ).toBe(false);
    });

    it('reclaims stalled jobs after the visibility timeout', async () => {
      const inserted = await driver.insertJob({ job: newJob(queueName, now) });
      await driver.claimJobs({
        queueName,
        limit: 1,
        lockDurationSeconds: 1,
        now,
      });
      const reclaimed = await driver.reclaimStalledJobs({ now: now + 5000, limit: 100 });
      expect(reclaimed.map((j) => j.jobId)).toContain(inserted.id);
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

    it('deduplicates two concurrent identical adds, not just sequential ones', async () => {
      // The race the per-queue dedup lock closes: without it both calls read no row under
      // READ COMMITTED and both insert, so `idempotencyKey` quietly stopped meaning anything. One of
      // the two must come back deduplicated, and both must name the same row.
      const add = () =>
        driver.insertJob({ job: newJob(queueName, now, { idempotencyKey: 'concurrent' }) });
      const [first, second] = await Promise.all([add(), add()]);

      expect(first.id).toBe(second.id);
      expect([first.deduplicated, second.deduplicated].filter(Boolean)).toHaveLength(1);
      const page = await driver.getJobs({ queueName, limit: 100, offset: 0 });
      expect(page.filter((j) => j.idempotencyKey === 'concurrent')).toHaveLength(1);
    });

    it('deduplicates two concurrent singleton adds while the slot is held', async () => {
      const add = () =>
        driver.insertJob({ job: newJob(queueName, now, { singletonKey: 'only-one' }) });
      const [first, second] = await Promise.all([add(), add()]);

      expect(first.id).toBe(second.id);
      expect([first.deduplicated, second.deduplicated].filter(Boolean)).toHaveLength(1);
      const page = await driver.getJobs({ queueName, limit: 100, offset: 0 });
      expect(page.filter((j) => j.singletonKey === 'only-one')).toHaveLength(1);
    });

    it('allows identical schedules to coexist and dedups by idempotency key', async () => {
      const base = {
        queueName,
        cron: '0 0 * * *',
        everySeconds: null,
        timezone: 'UTC',
        data: {},
        priority: null,
        retryMaxAttempts: null,
        retryDelaySeconds: null,
        nextRunAt: now + 1000,
        enabled: true,
        idempotencyKey: null,
        jobOptions: null,
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
      const after = await driver.getJobs({ queueName, limit: 100, offset: 0 });
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

    it('answers null for an instance that does not exist, and deletes one that does', async () => {
      // The instance page reads by key, and the dashboard's "tidy away a dead instance" action
      // deletes by key. Both need a definite answer for a key that names nothing.
      expect(await driver.getInstance({ instanceKey: 'never-seen' })).toBe(null);
      expect(await driver.deleteInstance({ instanceKey: 'never-seen' })).toBe(false);

      await driver.upsertInstance({ instanceKey: 'inst-gone', now });
      expect(await driver.deleteInstance({ instanceKey: 'inst-gone' })).toBe(true);
      expect(await driver.getInstance({ instanceKey: 'inst-gone' })).toBe(null);
      // Job rows record the instance key as a plain string, so a removal never touches them.
      expect(await driver.deleteInstance({ instanceKey: 'inst-gone' })).toBe(false);
    });

    it('counts jobs by status per instance, in one grouped query', async () => {
      // What the instances list renders. A key with no jobs must come back zeroed rather than absent,
      // so the page does not have to distinguish "none" from "unknown".
      const mine = await driver.insertJob({ job: newJob(queueName, now) });
      await driver.insertJob({ job: newJob(queueName, now) });
      const [claimed] = await driver.claimJobs({
        queueName,
        limit: 1,
        lockDurationSeconds: 60,
        now: now + 1,
        instanceKey: 'counter-1',
      });
      await driver.completeJob({
        jobId: mine.id,
        now: now + 2,
        lockToken: claimed?.lockToken ?? null,
      });

      const counts = await driver.countJobsByStatusPerInstance({
        instanceKeys: ['counter-1', 'counter-idle'],
      });
      expect(counts['counter-1']?.[JobStatus.COMPLETED]).toBe(1);
      expect(counts['counter-idle']).toEqual(
        expect.objectContaining({ [JobStatus.COMPLETED]: 0, [JobStatus.PENDING]: 0 }),
      );
      // The unclaimed job belongs to no instance, so it is in nobody's counts.
      expect(counts['counter-1']?.[JobStatus.PENDING]).toBe(0);
    });

    it('only lets a matching instance claim a job with a preferred pattern', async () => {
      await driver.insertJob({
        job: newJob(queueName, now, {
          data: { pin: 'eu' },
          preferredInstanceKeyPattern: '^worker-eu-',
        }),
      });
      // A non-matching instance must leave it alone.
      const us = await driver.claimJobs({
        queueName,
        limit: 10,
        lockDurationSeconds: 30,
        now: now + 1,
        instanceKey: 'worker-us-1',
      });
      expect(us).toHaveLength(0);
      // A matching instance claims it and is recorded as the processor.
      const eu = await driver.claimJobs({
        queueName,
        limit: 10,
        lockDurationSeconds: 30,
        now: now + 2,
        instanceKey: 'worker-eu-1',
      });
      expect(eu).toHaveLength(1);
      expect(eu[0]!.processedOnInstanceKey).toBe('worker-eu-1');
    });

    it('lets any instance claim a job with no preferred pattern', async () => {
      await driver.insertJob({ job: newJob(queueName, now) });
      const claim = await driver.claimJobs({
        queueName,
        limit: 10,
        lockDurationSeconds: 30,
        now: now + 1,
        instanceKey: 'worker-any-1',
      });
      expect(claim).toHaveLength(1);
    });

    it('pages past non-matching jobs to find ones this instance can claim', async () => {
      // A block of jobs targeted elsewhere, then one this instance matches, deep in the backlog.
      for (let i = 0; i < 30; i += 1) {
        await driver.insertJob({
          job: newJob(queueName, now, { data: { i }, preferredInstanceKeyPattern: '^worker-eu-' }),
        });
      }
      await driver.insertJob({
        job: newJob(queueName, now, {
          data: { mine: true },
          preferredInstanceKeyPattern: '^worker-us-',
        }),
      });
      const claim = await driver.claimJobs({
        queueName,
        limit: 5,
        lockDurationSeconds: 30,
        now: now + 1,
        instanceKey: 'worker-us-1',
      });
      expect(claim).toHaveLength(1);
      expect((claim[0]!.data as { mine?: boolean }).mine).toBe(true);
    });

    // --- Batch inserts ---

    it('inserts a batch in one call, preserving order and deduplicating within it', async () => {
      const inserted = await driver.insertJobs({
        jobs: [
          newJob(queueName, now, { data: { n: 1 }, idempotencyKey: 'b1' }),
          newJob(queueName, now, { data: { n: 2 } }),
          newJob(queueName, now, { data: { n: 3 } }),
        ],
      });
      expect(inserted).toHaveLength(3);
      expect(new Set(inserted.map((r) => r.id)).size).toBe(3);
      expect(inserted.every((r) => r.deduplicated === false)).toBe(true);

      // The same key again dedups against the row the batch just wrote.
      const again = await driver.insertJobs({
        jobs: [newJob(queueName, now, { idempotencyKey: 'b1' })],
      });
      expect(again[0]!.deduplicated).toBe(true);
      expect(again[0]!.id).toBe(inserted[0]!.id);
    });

    it('deduplicates a singleton key only while a job holds the slot', async () => {
      const first = await driver.insertJob({
        job: newJob(queueName, now, { singletonKey: 's1' }),
      });
      const blocked = await driver.insertJob({
        job: newJob(queueName, now, { singletonKey: 's1' }),
      });
      expect(blocked.deduplicated).toBe(true);
      expect(blocked.id).toBe(first.id);
      expect(blocked.deduplicationReason).toBe('SINGLETON');

      // Once it settles, the slot is free again.
      await driver.claimJobs({ queueName, limit: 1, lockDurationSeconds: 30, now: now + 1 });
      await driver.completeJob({ jobId: first.id, now: now + 2 });
      const next = await driver.insertJob({
        job: newJob(queueName, now, { singletonKey: 's1' }),
      });
      expect(next.deduplicated).toBe(false);
    });

    // --- Guards core depends on ---

    it('refuses to requeue an ACTIVE job, and re-arms a settled one', async () => {
      const active = await driver.insertJob({ job: newJob(queueName, now) });
      await driver.claimJobs({ queueName, limit: 1, lockDurationSeconds: 60, now: now + 1 });
      // Re-arming a running job would clear its lock and let a second worker claim it.
      expect(await driver.requeueJob({ jobId: active.id, now: now + 2 })).toBe(null);
      expect((await driver.getJob({ jobId: active.id }))?.status).toBe(JobStatus.ACTIVE);

      await driver.failJob({ jobId: active.id, lastError: 'boom', now: now + 3 });
      const requeued = await driver.requeueJob({ jobId: active.id, now: now + 4 });
      expect(requeued).toEqual(
        expect.objectContaining({ jobId: active.id, queueName, status: JobStatus.PENDING }),
      );
      const row = await driver.getJob({ jobId: active.id });
      expect(row?.status).toBe(JobStatus.PENDING);
      expect(row?.failureMessage).toBe(null);
      expect(row?.retryAttempt).toBe(0);

      // An unknown id is not an error — a stale id must never fail a batch.
      expect(await driver.requeueJob({ jobId: 'missing', now: now + 5 })).toBe(null);
    });

    it('clears every marker of a previous life when it re-arms a job', async () => {
      // A requeued job is starting over. Leaving `stalled_at`/`retried_at` set made the dashboard
      // show a "Stalled" and "Retried" marker from a previous run beside a PENDING status and a
      // zeroed attempt counter.
      const job = await driver.insertJob({ job: newJob(queueName, now) });
      await driver.claimJobs({ queueName, limit: 1, lockDurationSeconds: 1, now });
      await driver.reclaimStalledJobs({ now: now + 5000, limit: 10 }); // stamps stalled_at
      const [claimed] = await driver.claimJobs({
        queueName,
        limit: 1,
        lockDurationSeconds: 60,
        now: now + 5001,
      });
      await driver.retryJob({
        jobId: job.id,
        nextRunAt: now + 6000,
        retryAttempt: 1,
        lastError: 'boom',
        now: now + 5002,
        lockToken: claimed?.lockToken ?? null,
      }); // stamps retried_at
      const before = await driver.getJob({ jobId: job.id });
      expect(before?.stalledAt).not.toBe(null);
      expect(before?.retriedAt).not.toBe(null);

      await driver.requeueJob({ jobId: job.id, now: now + 7000 });
      const after = await driver.getJob({ jobId: job.id });
      expect(after?.status).toBe(JobStatus.PENDING);
      expect(after?.stalledAt).toBe(null);
      expect(after?.retriedAt).toBe(null);
      expect(after?.retryAttempt).toBe(0);
      expect(after?.lockedUntil).toBe(null);
      expect(after?.lockToken).toBe(null);
    });

    it('refuses to remove an ACTIVE job and returns the queue of one it removed', async () => {
      const job = await driver.insertJob({ job: newJob(queueName, now) });
      await driver.claimJobs({ queueName, limit: 1, lockDurationSeconds: 60, now: now + 1 });
      expect(await driver.removeJob({ jobId: job.id })).toBe(null);
      expect(await driver.getJob({ jobId: job.id })).not.toBe(null);

      await driver.completeJob({ jobId: job.id, now: now + 2 });
      expect(await driver.removeJob({ jobId: job.id })).toEqual({ jobId: job.id, queueName });
      expect(await driver.getJob({ jobId: job.id })).toBe(null);
    });

    it('cancels only a pending or retrying job', async () => {
      const pending = await driver.insertJob({ job: newJob(queueName, now) });
      expect(await driver.cancelJob({ jobId: pending.id, now: now + 1 })).toEqual({
        jobId: pending.id,
        queueName,
      });
      expect((await driver.getJob({ jobId: pending.id }))?.status).toBe(JobStatus.CANCELLED);
      // Already settled: nothing left to cancel.
      expect(await driver.cancelJob({ jobId: pending.id, now: now + 2 })).toBe(null);

      const active = await driver.insertJob({ job: newJob(queueName, now) });
      await driver.claimJobs({ queueName, limit: 1, lockDurationSeconds: 60, now: now + 1 });
      expect(await driver.cancelJob({ jobId: active.id, now: now + 3 })).toBe(null);
    });

    it('applies batch job control in one call, skipping ids it refuses', async () => {
      const settled = await driver.insertJob({ job: newJob(queueName, now, { data: { a: 1 } }) });
      const active = await driver.insertJob({ job: newJob(queueName, now, { data: { a: 2 } }) });
      await driver.claimJobs({ queueName, limit: 2, lockDurationSeconds: 60, now: now + 1 });
      await driver.completeJob({ jobId: settled.id, now: now + 2 });

      const requeued = await driver.requeueJobs({
        jobIds: [settled.id, active.id, 'missing'],
        now: now + 3,
      });
      expect(requeued.map((r) => r.jobId)).toEqual([settled.id]);

      const removed = await driver.removeJobs({ jobIds: [settled.id, active.id, 'missing'] });
      expect(removed.map((r) => r.jobId)).toEqual([settled.id]);
    });

    it('survives a batch at the id cap rather than overflowing a statement', async () => {
      // Every engine limits the expressions in an `IN (...)` list — Oracle at 1000, which is why
      // `MAX_BATCH_IDS` is 1000 everywhere. A batch right at the cap has to work, and one past it
      // has to be chunked rather than sent whole (which raised ORA-01795 and blew past the
      // parameter index on the others).
      const real = await driver.insertJob({ job: newJob(queueName, now) });
      const padding = Array.from({ length: MAX_BATCH_IDS - 1 }, (_, i) => `absent-${i}`);

      const atCap = await driver.removeJobs({ jobIds: [real.id, ...padding] });
      expect(atCap.map((r) => r.jobId)).toEqual([real.id]);

      // Past the cap: the driver chunks, so this is still one call that answers correctly.
      const second = await driver.insertJob({ job: newJob(queueName, now) });
      const overCap = await driver.removeJobs({
        jobIds: [second.id, ...padding, ...padding.map((p) => `${p}-b`)],
      });
      expect(overCap.map((r) => r.jobId)).toEqual([second.id]);
    });

    // --- Expiry ---

    it('expires due-but-unstarted jobs and leaves running ones alone', async () => {
      const expiring = await driver.insertJob({
        job: newJob(queueName, now, { expireAt: now + 1000 }),
      });
      const claimed = await driver.insertJob({
        job: newJob(queueName, now, { expireAt: now + 1000 }),
      });
      await driver.claimJobs({ queueName, limit: 1, lockDurationSeconds: 60, now: now + 1 });

      const expired = await driver.expireDueJobs({ now: now + 5000, limit: 100 });
      const expiredIds = expired.map((j) => j.jobId);
      // Exactly one of the two was still claimable; the other is ACTIVE and must survive.
      expect(expiredIds).toHaveLength(1);
      expect(expired[0]!.queueName).toBe(queueName);
      const survivor = expiredIds.includes(expiring.id) ? claimed.id : expiring.id;
      expect((await driver.getJob({ jobId: survivor }))?.status).toBe(JobStatus.ACTIVE);
      expect((await driver.getJob({ jobId: expiredIds[0]! }))?.status).toBe(JobStatus.EXPIRED);
    });

    it('honours the limit on expiry and reclaim', async () => {
      for (let i = 0; i < 5; i += 1) {
        await driver.insertJob({ job: newJob(queueName, now, { expireAt: now + 1000 }) });
      }
      const first = await driver.expireDueJobs({ now: now + 5000, limit: 2 });
      expect(first).toHaveLength(2);
      const rest = await driver.expireDueJobs({ now: now + 5000, limit: 10 });
      expect(rest).toHaveLength(3);
    });

    // --- Retention ---

    it('deletes finished jobs whose TTL elapsed, and only those', async () => {
      const kept = await driver.insertJob({
        job: newJob(queueName, now, { retentionTtlSeconds: null }),
      });
      const swept = await driver.insertJob({
        job: newJob(queueName, now, {
          retentionTtlSeconds: 10,
        }),
      });
      const tooYoung = await driver.insertJob({
        job: newJob(queueName, now, {
          retentionTtlSeconds: 10_000,
        }),
      });
      for (const id of [kept.id, swept.id, tooYoung.id]) {
        await driver.claimJobs({ queueName, limit: 1, lockDurationSeconds: 60, now: now + 1 });
        await driver.completeJob({ jobId: id, now: now + 2 });
      }
      const removed = await driver.deleteFinishedJobs({ olderThan: now + 60_000, limit: 100 });
      expect(removed).toBe(1);
      expect(await driver.getJob({ jobId: swept.id })).toBe(null);
      expect(await driver.getJob({ jobId: kept.id })).not.toBe(null);
      expect(await driver.getJob({ jobId: tooYoung.id })).not.toBe(null);
    });

    it('scopes retention to the statuses the job itself named', async () => {
      // Same TTL; one policy covers FAILED only, the other every finished status.
      const scoped = await driver.insertJob({
        job: newJob(queueName, now, {
          retentionTtlSeconds: 10,
          retentionStatuses: [JobStatus.FAILED],
        }),
      });
      const unscoped = await driver.insertJob({
        job: newJob(queueName, now, {
          retentionTtlSeconds: 10,
        }),
      });
      for (const id of [scoped.id, unscoped.id]) {
        await driver.claimJobs({ queueName, limit: 1, lockDurationSeconds: 60, now: now + 1 });
        await driver.completeJob({ jobId: id, now: now + 2 });
      }
      const removed = await driver.deleteFinishedJobs({ olderThan: now + 60_000, limit: 100 });
      expect(removed).toBe(1);
      // The scoped job completed rather than failed, so its own policy leaves it in place.
      expect(await driver.getJob({ jobId: scoped.id })).not.toBe(null);
      expect(await driver.getJob({ jobId: unscoped.id })).toBe(null);
    });

    // --- Schedules ---

    it('lets exactly one caller win a guarded schedule advance', async () => {
      const schedule = await driver.insertSchedule({
        schedule: {
          queueName,
          cron: null,
          everySeconds: 60,
          timezone: null,
          data: {},
          priority: null,
          retryMaxAttempts: null,
          retryDelaySeconds: null,
          nextRunAt: now,
          enabled: true,
          idempotencyKey: null,
          jobOptions: null,
        },
      });
      const advance = (): Promise<boolean> =>
        driver.advanceSchedule({
          scheduleId: schedule.id,
          nextRunAt: now + 60_000,
          lastRunAt: now,
          fromNextRunAt: now,
        });
      // Both read the same `fromNextRunAt`; only the first may win.
      expect(await advance()).toBe(true);
      expect(await advance()).toBe(false);
      expect((await driver.getSchedule({ scheduleId: schedule.id }))?.nextRunAt).toBe(now + 60_000);
    });

    it('returns due schedules only once they are armed and due', async () => {
      const base = {
        queueName,
        cron: null,
        everySeconds: 60,
        timezone: null,
        data: {},
        priority: null,
        retryMaxAttempts: null,
        retryDelaySeconds: null,
        nextRunAt: now,
        enabled: true,
        idempotencyKey: null,
        jobOptions: null,
      };
      const due = await driver.insertSchedule({ schedule: base });
      await driver.insertSchedule({ schedule: { ...base, nextRunAt: now + 60_000 } });
      const disarmed = await driver.insertSchedule({ schedule: { ...base, enabled: false } });

      const found = await driver.getDueSchedules({ now, limit: 100 });
      expect(found.map((s) => s.id)).toEqual([due.id]);

      // Arming the disabled one brings it into the due set.
      const toggled = await driver.setScheduleEnabled({
        scheduleId: disarmed.id,
        enabled: true,
        now,
      });
      expect(toggled).toEqual({ scheduleId: disarmed.id, queueName });
      expect((await driver.getDueSchedules({ now, limit: 100 })).map((s) => s.id)).toEqual(
        expect.arrayContaining([due.id, disarmed.id]),
      );
    });

    it('deletes schedules in one call and reports each removed row with its queue', async () => {
      const base = {
        queueName,
        cron: null,
        everySeconds: 60,
        timezone: null,
        data: {},
        priority: null,
        retryMaxAttempts: null,
        retryDelaySeconds: null,
        nextRunAt: now,
        enabled: true,
        idempotencyKey: null,
        jobOptions: null,
      };
      const a = await driver.insertSchedule({ schedule: base });
      const b = await driver.insertSchedule({ schedule: base });
      const removed = await driver.deleteSchedules({
        scheduleIds: [a.id, b.id, 'missing'],
      });
      expect(removed).toHaveLength(2);
      expect(removed.every((r) => r.queueName === queueName)).toBe(true);
      expect(await driver.getSchedule({ scheduleId: a.id })).toBe(null);
      // An unknown id is skipped, not an error.
      expect(await driver.deleteSchedule({ scheduleId: 'missing' })).toBe(null);
    });

    it('arms and disarms a schedule without deleting it, returning its ref', async () => {
      // The dashboard's enable/disable toggle. The ref is what lets it emit an event naming the
      // schedule's queue without reading the row back.
      const schedule = await driver.insertSchedule({
        schedule: {
          queueName,
          cron: null,
          everySeconds: 60,
          timezone: null,
          data: {},
          priority: null,
          retryMaxAttempts: null,
          retryDelaySeconds: null,
          nextRunAt: now,
          enabled: true,
          idempotencyKey: null,
          jobOptions: null,
        },
      });

      const disabled = await driver.setScheduleEnabled({
        scheduleId: schedule.id,
        enabled: false,
        now: now + 1,
      });
      expect(disabled).toEqual({ scheduleId: schedule.id, queueName });
      expect((await driver.getSchedule({ scheduleId: schedule.id }))?.enabled).toBe(false);
      // A disarmed schedule is not due, however far past its next run the clock is.
      const due = await driver.getDueSchedules({ now: now + 60_000, limit: 10 });
      expect(due.map((s) => s.id)).not.toContain(schedule.id);

      const rearmed = await driver.setScheduleEnabled({
        scheduleId: schedule.id,
        enabled: true,
        now: now + 2,
      });
      expect(rearmed).toEqual({ scheduleId: schedule.id, queueName });
      expect(
        (await driver.getDueSchedules({ now: now + 60_000, limit: 10 })).map((s) => s.id),
      ).toContain(schedule.id);

      // An unknown id changes nothing and says so, so a stale toggle is not an error.
      expect(await driver.setScheduleEnabled({ scheduleId: 'missing', enabled: false, now })).toBe(
        null,
      );
    });

    // --- Reads: filters, search and page/count agreement ---

    it('matches the free-text search in SQL across id, status, key, failure and payload', async () => {
      const needle = await driver.insertJob({
        job: newJob(queueName, now, {
          data: { recipient: 'ada@example.com' },
          idempotencyKey: 'welcome-ada',
        }),
      });
      await driver.insertJob({ job: newJob(queueName, now, { data: { recipient: 'bob@x.io' } }) });

      const byPayload = await driver.getJobs({ search: 'ada@example', limit: 50, offset: 0 });
      expect(byPayload.map((j) => j.id)).toEqual([needle.id]);

      const byKey = await driver.getJobs({ search: 'WELCOME-ADA', limit: 50, offset: 0 });
      expect(byKey.map((j) => j.id)).toEqual([needle.id]);

      const byId = await driver.getJobs({ search: needle.id, limit: 50, offset: 0 });
      expect(byId.map((j) => j.id)).toEqual([needle.id]);

      // A term with LIKE metacharacters searches for that text, not everything.
      expect(await driver.getJobs({ search: '%', limit: 50, offset: 0 })).toHaveLength(0);
    });

    it('agrees between every list page and its count', async () => {
      for (let i = 0; i < 7; i += 1) {
        await driver.insertJob({ job: newJob(queueName, now, { data: { i } }) });
      }
      const filter = { queueName, statuses: [JobStatus.PENDING] };
      const page = await driver.getJobs({ ...filter, limit: 3, offset: 0 });
      const second = await driver.getJobs({ ...filter, limit: 3, offset: 3 });
      expect(page).toHaveLength(3);
      expect(second).toHaveLength(3);
      expect(await driver.countJobs(filter)).toBe(7);
      // No id appears on two pages.
      expect(new Set([...page, ...second].map((j) => j.id)).size).toBe(6);

      // The same agreement for the other three lists.
      expect((await driver.listQueues({ limit: 10, offset: 0 })).length).toBe(
        await driver.countQueues(),
      );
      expect((await driver.listSchedules({ limit: 10, offset: 0 })).length).toBe(
        await driver.countSchedules({}),
      );
      await driver.upsertInstance({ instanceKey: 'inst-page', now });
      expect((await driver.listInstances({ limit: 10, offset: 0 })).length).toBe(
        await driver.countInstances(),
      );
    });

    it('narrows a queue list by search and pause state, in SQL', async () => {
      await driver.ensureQueue({ name: 'alpha-billing', now });
      await driver.ensureQueue({ name: 'beta-email', now });
      await driver.setQueuePaused({
        queueName: 'alpha-billing',
        processingPaused: true,
        now,
      });
      expect((await driver.listQueues({ search: 'BILL' })).map((q) => q.name)).toEqual([
        'alpha-billing',
      ]);
      expect(await driver.countQueues({ search: 'bill' })).toBe(1);
      expect((await driver.listQueues({ processingPaused: true })).map((q) => q.name)).toEqual([
        'alpha-billing',
      ]);
    });

    it('gets or creates a queue without ever rewriting an existing row', async () => {
      const created = await driver.ensureQueue({ name: 'idem-queue', now });
      await driver.setQueuePaused({ queueName: 'idem-queue', processingPaused: true, now });
      // A second ensure must not reset the pause flag it found.
      const again = await driver.ensureQueue({ name: 'idem-queue', now: now + 1000 });
      expect(again.processingPaused).toBe(true);
      expect(again.createdAt).toBe(created.createdAt);
      // Concurrent ensures resolve to one row.
      await Promise.all([
        driver.ensureQueue({ name: 'race-queue', now }),
        driver.ensureQueue({ name: 'race-queue', now }),
      ]);
      expect((await driver.listQueues({ search: 'race-queue' })).length).toBe(1);
    });

    it('reports a null schema version before migrating rather than failing', async () => {
      const fresh = options.createDriver();
      await fresh.connect();
      try {
        expect(await fresh.getSchemaVersion()).toBe(null);
        for (const migration of fresh.migrations) await fresh.applyMigration({ migration });
        expect(await fresh.getSchemaVersion()).toBe(
          fresh.migrations.reduce((max, m) => Math.max(max, m.version), 0),
        );
        // Re-applying is a no-op, not a duplicate-version error.
        for (const migration of fresh.migrations) await fresh.applyMigration({ migration });
      } finally {
        await fresh.disconnect();
      }
    });
  });
}
