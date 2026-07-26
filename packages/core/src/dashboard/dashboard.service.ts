/**
 * The `pq._dashboard` facade — everything `@portqueue/dashboard` needs that the public API
 * deliberately does not offer. Nothing here is a documented developer API (the `_` prefix on the
 * property says so); it exists so a dashboard requirement never forces a change to `PortQueue`.
 *
 * Three things this class is careful about, each a bug the dashboard used to have:
 *
 * - **It never calls `createQueue`.** `createQueue` registers a queue in the host process, which
 *   flips `QueueInfo.inUse` to true forever and makes `removeQueue` throw. Every read and write
 *   here goes to the driver directly, or through a `Queue` handle the *developer* already created.
 * - **Lists are paged and counted in the database**, not fetched whole and sliced in the browser.
 * - **Batches share one transaction**, so a bulk action is all-or-nothing rather than N
 *   independent round-trips that can half-apply.
 */
import { JobStatus } from '../jobs/job-state.enum';
import { PortQueueEvent } from '../events/event-name.enum';
import { InvalidOptionsError } from '../errors/errors';
import { toSnapshot } from '../jobs/snapshot';
import {
  DASHBOARD_MAX_LIMIT,
  JobBatchAction,
  type BatchResult,
  type DashboardPageQuery,
  type DashboardStats,
  type GetInstancesQuery,
  type GetQueuesQuery,
  type GetSchedulesQuery,
  type JobSearchQuery,
  type Page,
  type ScheduleWithQueue,
} from './dashboard-results';
import type { Runtime } from '../client/runtime';
import type { Driver } from '../drivers/driver.interface';
import type { GetJobsQuery, InstanceInfo, JobSnapshot, QueueInfo } from '../producer/results';
import type { JobRecord } from '../jobs/job-record';
import type { ReadService } from '../monitoring/stats.service';
import type { TransactionHandle } from '../tx/transaction-handle';

/** The default liveness window when the host set no explicit heartbeat interval. */
const DEFAULT_HEARTBEAT_SECONDS = 15;

/**
 * Rows a free-text job search reads per round trip. A search scans the whole matching set (see
 * {@link DashboardService.getJobs}); this only decides how many rows travel at a time — big enough
 * that a large table doesn't turn into thousands of queries, small enough that one chunk is never a
 * memory problem.
 */
const SEARCH_CHUNK_SIZE = 1000;

/** Clamp a caller-supplied page window to something the database is happy to serve. */
function pageWindow(query: DashboardPageQuery): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), DASHBOARD_MAX_LIMIT);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
  return { limit, offset };
}

export class DashboardService {
  constructor(
    private readonly runtime: Runtime,
    private readonly reads: ReadService,
  ) {}

  /**
   * The live driver, for the rare case the dashboard needs to compose its own transaction (see
   * {@link runInTransaction}). Exposed here rather than on `PortQueue` so the driver never becomes
   * part of the developer-facing surface.
   */
  get driver(): Driver {
    return this.runtime.driver;
  }

  /**
   * Run `fn` inside one driver transaction. The dashboard's batch endpoints use this so a bulk
   * retry/cancel/remove either applies to every selected row or to none of them.
   */
  runInTransaction<T>(options: { fn: (tx: TransactionHandle) => Promise<T> }): Promise<T> {
    return this.runtime.driver.runInTransaction(options);
  }

  // --- Paged lists -------------------------------------------------------------------------

  /**
   * A page of queues with their per-status counts. The counts come from a single grouped query
   * over just this page's queue names, so the cost is two queries per page rather than one per
   * queue.
   */
  async getQueues(query: GetQueuesQuery = {}): Promise<Page<QueueInfo>> {
    const { limit, offset } = pageWindow(query);
    const filter = {
      ...(query.search ? { search: query.search } : {}),
      ...(query.processingPaused !== undefined ? { processingPaused: query.processingPaused } : {}),
    };

    // `inUse` is this process's own registry state, not a column, so it can't be pushed into SQL.
    // When it's filtered on, page in memory over the (already name-filtered) rows instead.
    if (query.inUse !== undefined) {
      const all = await this.runtime.driver.listQueues(filter);
      const matching = all.filter((row) => this.isInUse(row.name) === query.inUse);
      const rows = matching.slice(offset, offset + limit);
      return {
        items: await this.withQueueCounts(rows),
        cursor: null,
        hasMore: offset + rows.length < matching.length,
        total: matching.length,
      };
    }

    const [rows, total] = await Promise.all([
      this.runtime.driver.listQueues({ ...filter, limit, offset }),
      this.runtime.driver.countQueues(filter),
    ]);
    return {
      items: await this.withQueueCounts(rows),
      cursor: null,
      hasMore: offset + rows.length < total,
      total,
    };
  }

  /** Attach the per-status count breakdown to a page of queue rows in one grouped query. */
  private async withQueueCounts(
    rows: { name: string; processingPaused: boolean; acceptingPaused: boolean }[],
  ): Promise<QueueInfo[]> {
    if (!rows.length) return [];
    const counts = await this.runtime.driver.countJobsByStatusPerQueue({
      queueNames: rows.map((r) => r.name),
    });
    return rows.map((row) => ({
      name: row.name,
      processingPaused: row.processingPaused,
      acceptingPaused: row.acceptingPaused,
      counts: counts[row.name] ?? emptyCounts(),
      inUse: this.isInUse(row.name),
    }));
  }

  private isInUse(name: string): boolean {
    return this.runtime.registry.isRegistered(name);
  }

  /** A page of instances with liveness and per-instance job attribution. */
  async getInstances(query: GetInstancesQuery = {}): Promise<Page<InstanceInfo>> {
    const { limit, offset } = pageWindow(query);
    const now = this.runtime.clock.now();
    const staleAfter =
      (this.runtime.options.instance?.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_SECONDS) *
      3 *
      1000;
    const seenSince = now - staleAfter;
    const filter = {
      ...(query.search ? { search: query.search } : {}),
      ...(query.processingPaused !== undefined ? { processingPaused: query.processingPaused } : {}),
      // The liveness cutoff is computed here; the driver only compares against it.
      ...(query.alive !== undefined ? { alive: query.alive, seenSince } : {}),
    };
    const [rows, total] = await Promise.all([
      this.runtime.driver.listInstances({ ...filter, limit, offset }),
      this.runtime.driver.countInstances(filter),
    ]);
    const counts = rows.length
      ? await this.runtime.driver.countJobsByStatusPerInstance({
          instanceKeys: rows.map((r) => r.instanceKey),
        })
      : {};
    return {
      items: rows.map((row) => ({
        instanceKey: row.instanceKey,
        processingPaused: row.processingPaused,
        alive: row.lastSeenAt >= seenSince,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
        lastSeenAt: new Date(row.lastSeenAt),
        counts: counts[row.instanceKey] ?? emptyCounts(),
      })),
      cursor: null,
      hasMore: offset + rows.length < total,
      total,
    };
  }

  /**
   * A page of schedules across every queue, in one query. The public `queue.getSchedules()` reads
   * a single queue and requires a `Queue` handle — building one per queue is both an N+1 and the
   * registry-pollution bug described in this class's header.
   */
  async getSchedules(query: GetSchedulesQuery = {}): Promise<Page<ScheduleWithQueue>> {
    const { limit, offset } = pageWindow(query);
    const filter = {
      ...(query.queue ? { queueName: query.queue } : {}),
      ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
      ...(query.search ? { search: query.search } : {}),
    };
    const [rows, total] = await Promise.all([
      this.runtime.driver.listSchedules({ ...filter, limit, offset }),
      this.runtime.driver.countSchedules(filter),
    ]);
    return {
      items: rows.map((s) => ({
        scheduleId: s.id,
        queue: s.queueName,
        cron: s.cron,
        everySeconds: s.everySeconds,
        timezone: s.timezone,
        nextRunAt: s.nextRunAt != null ? new Date(s.nextRunAt) : null,
        lastRunAt: s.lastRunAt != null ? new Date(s.lastRunAt) : null,
        enabled: s.enabled,
        idempotencyKey: s.idempotencyKey,
      })),
      cursor: null,
      hasMore: offset + rows.length < total,
      total,
    };
  }

  /** One schedule by id, with its queue — backs the schedule detail page. */
  async getSchedule(options: { scheduleId: string }): Promise<ScheduleWithQueue | null> {
    const s = await this.runtime.driver.getSchedule({ scheduleId: options.scheduleId });
    if (!s) return null;
    return {
      scheduleId: s.id,
      queue: s.queueName,
      cron: s.cron,
      everySeconds: s.everySeconds,
      timezone: s.timezone,
      nextRunAt: s.nextRunAt != null ? new Date(s.nextRunAt) : null,
      lastRunAt: s.lastRunAt != null ? new Date(s.lastRunAt) : null,
      enabled: s.enabled,
      idempotencyKey: s.idempotencyKey,
    };
  }

  /** Counts only — the activity cards. No throughput or failure-rate derivation. */
  async getStats(options: { queue?: string } = {}): Promise<DashboardStats> {
    const counts = await this.runtime.driver.countJobsByStatus(
      options.queue ? { queueName: options.queue } : {},
    );
    return { ...(options.queue ? { queue: options.queue } : {}), counts };
  }

  // --- Jobs --------------------------------------------------------------------------------

  /**
   * A page of jobs, optionally narrowed by a free-text search. Without a search this is the public
   * paged read.
   *
   * With one, the whole matching set is searched — every job the other filters allow, oldest
   * included. The engine carries no text index on ids, payloads or failure messages, so the term is
   * matched in JS; that is done over a **chunked scan** ({@link SEARCH_CHUNK_SIZE} rows a round
   * trip) rather than by loading the table into memory. Only the rows that fall inside the
   * requested page are kept — everything else is counted and dropped — so memory is bounded by the
   * page size, not by the table.
   *
   * A search therefore costs O(rows / chunk) queries and reports a `total` that is the true number
   * of matches. The alternative, a bounded window, silently answered a different question: "the
   * most recent N jobs matched nothing" reads exactly like "nothing matched".
   */
  async getJobs<TData = unknown>(
    query: GetJobsQuery & JobSearchQuery = {},
  ): Promise<Page<JobSnapshot<TData>>> {
    const term = query.search?.trim().toLowerCase();
    const { search: _search, ...base } = query;
    if (!term) return this.reads.getJobs<TData>(base);

    const limit = Math.min(Math.max(Math.trunc(base.limit ?? 50), 1), DASHBOARD_MAX_LIMIT);
    const offset = Math.max(Math.trunc(base.offset ?? 0), 0);
    const order = base.order ?? 'desc';
    const filter = {
      ...(base.queue ? { queueName: base.queue } : {}),
      ...(base.statuses ? { statuses: base.statuses } : {}),
      ...(base.scheduleId ? { scheduleId: base.scheduleId } : {}),
    };

    const now = this.runtime.clock.now();
    const items: JobSnapshot<TData>[] = [];
    let matches = 0;

    for (let scanned = 0; ; scanned += SEARCH_CHUNK_SIZE) {
      const records = await this.runtime.driver.getJobs({
        ...filter,
        limit: SEARCH_CHUNK_SIZE,
        offset: scanned,
        order,
      });
      for (const record of records) {
        const job = toSnapshot<TData>(record, record.queueName, now);
        if (!matchesJobSearch(job, term)) continue;
        // Keep only the slice the caller asked for; the rest of the matches just move `total`.
        if (matches >= offset && items.length < limit) items.push(job);
        matches += 1;
      }
      // A short chunk is the end of the table — the only place this loop stops.
      if (records.length < SEARCH_CHUNK_SIZE) break;
    }

    return {
      items,
      cursor: null,
      hasMore: offset + items.length < matches,
      total: matches,
    };
  }

  // --- Batch actions -----------------------------------------------------------------------

  /**
   * Apply one action to many jobs inside a **single transaction**: if any one of them throws, the
   * whole batch rolls back and nothing is half-applied. Ids that simply didn't match (already
   * gone, or an ACTIVE row a remove refuses) don't fail the batch — they just don't count toward
   * `affected`.
   *
   * Cancellation is the one action with a non-transactional side effect: a job running *in this
   * process* is cancelled by firing its handler's `AbortSignal`, which no transaction can undo.
   * Those are fired only after the transaction commits, so a rollback can't leave a handler
   * aborted for a batch that never applied.
   */
  async runJobBatch(options: {
    queue: string;
    jobIds: string[];
    action: JobBatchAction;
  }): Promise<BatchResult> {
    const { queue, jobIds, action } = options;
    if (!jobIds.length) return { affected: 0, requested: 0 };

    const now = this.runtime.clock.now();
    const driver = this.runtime.driver;

    // Cancel first checks which ids are running here; those settle via their own signal below.
    const locallyRunning =
      action === JobBatchAction.CANCEL
        ? jobIds.filter((id) => this.runtime.cancelRunning !== undefined && this.isRunningHere(id))
        : [];

    const affected = await driver.runInTransaction({
      fn: async (tx) => {
        let n = 0;
        switch (action) {
          case JobBatchAction.REMOVE:
            // The driver removes by id set in one statement and reports the row count.
            n = await driver.removeJobsByIds({ jobIds, queueName: queue, tx });
            break;
          case JobBatchAction.RETRY:
            for (const jobId of jobIds) {
              await driver.requeueJob({ jobId, now, tx });
              n += 1;
            }
            break;
          case JobBatchAction.CANCEL:
            for (const jobId of jobIds) {
              if (locallyRunning.includes(jobId)) {
                // Settled by its own handler after commit; still counts as acted on.
                n += 1;
                continue;
              }
              if (await driver.cancelJob({ jobId, now, tx })) n += 1;
            }
            break;
          default:
            throw new InvalidOptionsError(`Unknown job batch action '${String(action)}'.`);
        }
        return n;
      },
    });

    // Post-commit effects: waking workers and firing events must not happen for a rolled-back
    // batch, so they all live here rather than inside the transaction above.
    if (action === JobBatchAction.RETRY) {
      this.runtime.wakeup.signal(queue);
      for (const jobId of jobIds) {
        this.runtime.events.emit(PortQueueEvent.JOB_ADDED, { jobId, queue, deduplicated: false });
      }
    } else if (action === JobBatchAction.CANCEL) {
      for (const jobId of locallyRunning) this.runtime.cancelRunning?.(jobId);
      for (const jobId of jobIds) {
        this.runtime.events.emit(PortQueueEvent.JOB_CANCELLED, { jobId, queue });
      }
    } else {
      for (const jobId of jobIds) {
        this.runtime.events.emit(PortQueueEvent.JOB_REMOVED, { jobId, queue });
      }
    }

    return { affected, requested: jobIds.length };
  }

  /**
   * Remove many schedules in one transaction. Core's public API only removes them one at a time
   * (and only through a `Queue` handle), which this facade deliberately avoids constructing.
   */
  async removeSchedules(options: { scheduleIds: string[] }): Promise<BatchResult> {
    const { scheduleIds } = options;
    if (!scheduleIds.length) return { affected: 0, requested: 0 };
    const driver = this.runtime.driver;
    // Read the rows first: the SCHEDULE_REMOVED event names the queue, which the id alone doesn't.
    const rows = await Promise.all(
      scheduleIds.map((scheduleId) => driver.getSchedule({ scheduleId })),
    );
    const affected = await driver.runInTransaction({
      fn: async (tx) => {
        let n = 0;
        for (const scheduleId of scheduleIds) {
          if (await driver.deleteSchedule({ scheduleId, tx })) n += 1;
        }
        return n;
      },
    });
    for (const row of rows) {
      if (row) {
        this.runtime.events.emit(PortQueueEvent.SCHEDULE_REMOVED, {
          scheduleId: row.id,
          queue: row.queueName,
        });
      }
    }
    return { affected, requested: scheduleIds.length };
  }

  /** Arm or disarm a schedule. Core exposes the flag as read-only; the dashboard can toggle it. */
  async setScheduleEnabled(options: { scheduleId: string; enabled: boolean }): Promise<boolean> {
    const row = await this.runtime.driver.getSchedule({ scheduleId: options.scheduleId });
    if (!row) return false;
    const ok = await this.runtime.driver.runInTransaction({
      fn: (tx) =>
        this.runtime.driver.setScheduleEnabled({
          scheduleId: options.scheduleId,
          enabled: options.enabled,
          now: this.runtime.clock.now(),
          tx,
        }),
    });
    if (ok) {
      this.runtime.events.emit(PortQueueEvent.SCHEDULE_UPDATED, {
        scheduleId: options.scheduleId,
        queue: row.queueName,
      });
    }
    return ok;
  }

  /** Whether this process is currently running the job (so a cancel fires its signal). */
  private isRunningHere(jobId: string): boolean {
    // `cancelRunning` both tests and acts, so it can't be used as a probe here without
    // cancelling. `isJobRunningHere` is the read-only half.
    return this.runtime.isJobRunningHere?.(jobId) ?? false;
  }
}

/** A zeroed status breakdown, for a key the grouped count query returned nothing for. */
function emptyCounts(): Record<JobStatus, number> {
  return {
    [JobStatus.PENDING]: 0,
    [JobStatus.ACTIVE]: 0,
    [JobStatus.COMPLETED]: 0,
    [JobStatus.FAILED]: 0,
    [JobStatus.RETRY]: 0,
    [JobStatus.CANCELLED]: 0,
    [JobStatus.EXPIRED]: 0,
  };
}

/**
 * The dashboard's free-text job match. Covers what the table shows (id, status) plus the three
 * fields operators actually search by during triage: the idempotency key, the failure message,
 * and the payload.
 */
function matchesJobSearch(job: JobSnapshot<unknown>, term: string): boolean {
  if (job.id.toLowerCase().includes(term)) return true;
  if (job.status.toLowerCase().includes(term)) return true;
  if (job.idempotencyKey?.toLowerCase().includes(term)) return true;
  if (job.failureMessage?.toLowerCase().includes(term)) return true;
  return serializePayload(job.data).includes(term);
}

/** Lower-cased text form of a payload, for substring search. Cyclic data degrades to no match. */
function serializePayload(data: unknown): string {
  if (data == null) return '';
  if (typeof data === 'string') return data.toLowerCase();
  if (typeof data === 'number' || typeof data === 'boolean') return String(data).toLowerCase();
  try {
    return JSON.stringify(data)?.toLowerCase() ?? '';
  } catch {
    return '';
  }
}

export type { JobRecord };
