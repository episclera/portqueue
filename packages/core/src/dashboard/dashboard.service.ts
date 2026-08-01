/**
 * The `pq._dashboard` facade — everything `@portqueue/dashboard` needs that the public API
 * deliberately does not offer. Nothing here is a documented developer API (the `_` prefix on the
 * property says so); it exists so a dashboard requirement never forces a change to `PortQueue`.
 *
 * Three things this class is careful about, each a bug the dashboard used to have:
 *
 * - **Every filter runs in the database.** A free-text job search is a `LIKE` in SQL, not a chunked
 *   scan of the table through this process; a list page is `LIMIT`/`OFFSET`, never a whole-table read
 *   sliced in memory.
 * - **A batch is one statement.** `retry`, `cancel` and `remove` each hand the whole id set to one
 *   driver call, so the cost is constant in the number of ids and a single stale id cannot roll back
 *   the rest of the batch.
 * - **It never declares a queue.** Reads and writes address a queue by name; the client this runs on
 *   is headless (see `PortQueueOptions._headless`), so it registers nothing and owns nothing.
 */
import { PortQueueEvent } from '../events/event-name.enum';
import { InvalidOptionsError } from '../errors/errors';
import { assertBatchIds } from '../util/batch-ids';
import { pageWindow } from '../monitoring/stats.service';
import { DASHBOARD_MAX_PAGE_LIMIT, DEFAULT_PAGE_LIMIT } from '../constants';
import {
  JobBatchAction,
  type BatchResult,
  type DashboardStats,
  type DashboardInstancesQuery,
  type DashboardQueuesQuery,
  type DashboardSchedulesQuery,
  type JobInstanceFilter,
  type JobSearchQuery,
  type Page,
} from './dashboard-results';
import type { Runtime } from '../client/runtime';
import type { Driver, JobRef } from '../drivers/driver.interface';
import type {
  GetJobsQuery,
  InstanceInfo,
  JobSnapshot,
  QueueInfo,
  ScheduleInfo,
} from '../producer/results';
import type { JobRecord } from '../jobs/job-record';
import type { ReadService } from '../monitoring/stats.service';
import type { ProducerService } from '../producer/producer.service';
import type { TransactionHandle } from '../tx/transaction-handle';

export class DashboardService {
  constructor(
    private readonly runtime: Runtime,
    private readonly reads: ReadService,
    private readonly producer: ProducerService,
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
   * Run `fn` inside one driver transaction. Left on the facade for a caller that needs to compose
   * several driver calls atomically; the batch actions below no longer need it, because each is a
   * single statement.
   */
  runInTransaction<T>(options: { fn: (tx: TransactionHandle) => Promise<T> }): Promise<T> {
    return this.runtime.driver.runInTransaction(options);
  }

  // --- Paged lists -------------------------------------------------------------------------

  /**
   * A page of queues with their per-status counts.
   *
   * The public read already narrows by name and pause state in SQL and counts the whole page in one
   * grouped query, so this only tightens the page ceiling: a dashboard table never shows more than
   * {@link DASHBOARD_MAX_PAGE_LIMIT} rows, and a crafted `limit` must not be able to ask for the
   * table. Reusing the public read is what the facade rule allows and what keeps the two from
   * drifting — they were byte-identical bodies over the same driver calls.
   */
  getQueues(query: DashboardQueuesQuery = {}): Promise<Page<QueueInfo>> {
    return this.reads.getQueues({ ...query, ...pageWindow(query, DASHBOARD_MAX_PAGE_LIMIT) });
  }

  /** A page of instances with liveness and per-instance job attribution. Clamped like the queues. */
  getInstances(query: DashboardInstancesQuery = {}): Promise<Page<InstanceInfo>> {
    return this.reads.getInstances({ ...query, ...pageWindow(query, DASHBOARD_MAX_PAGE_LIMIT) });
  }

  /**
   * One instance by key, with the same liveness, health and attribution the list carries — for the
   * instance detail page. `PortQueue.getInstance` covers this, but the facade keeps its own entry
   * point so the dashboard's routes read uniformly.
   */
  getInstance(options: { instanceKey: string }): Promise<InstanceInfo | null> {
    return this.reads.getInstance(options.instanceKey);
  }

  /**
   * A page of schedules across every queue, in one query. Delegates to the same producer read
   * `pq.getSchedules` uses, plus the free-text filter only this table offers.
   */
  async getSchedules(query: DashboardSchedulesQuery = {}): Promise<Page<ScheduleInfo>> {
    const { limit, offset } = pageWindow(query, DASHBOARD_MAX_PAGE_LIMIT);
    if (!query.search) {
      return this.producer.getSchedules({
        ...(query.queue ? { queue: query.queue } : {}),
        ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
        limit,
        offset,
      });
    }
    const filter = {
      ...(query.queue ? { queueName: query.queue } : {}),
      ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
      search: query.search,
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
      total,
    };
  }

  /** One schedule by id, with its queue — backs the schedule detail page. */
  getSchedule(options: { scheduleId: string }): Promise<ScheduleInfo | null> {
    return this.producer.getSchedule(options.scheduleId);
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
   * A page of jobs, optionally narrowed by a free-text search.
   *
   * The search is a SQL `LIKE` across the five fields an operator triages by — id, status,
   * idempotency key, failure message and the serialized payload — so it pages in the database and
   * `total` is a `COUNT`. The previous implementation read the whole matching set through this
   * process in 1000-row chunks and filtered in JS: bounded in memory, but O(rows / 1000) queries and
   * a `JSON.parse` of every payload in the table for one keystroke.
   */
  getJobs<TData = unknown>(
    query: GetJobsQuery & JobSearchQuery & JobInstanceFilter = {},
  ): Promise<Page<JobSnapshot<TData>>> {
    const term = query.search?.trim();
    const { search: _search, ...base } = query;
    return this.reads.getJobs<TData>({
      ...base,
      ...(term ? { search: term } : {}),
      limit: Math.min(
        Math.max(Math.trunc(base.limit ?? DEFAULT_PAGE_LIMIT), 1),
        DASHBOARD_MAX_PAGE_LIMIT,
      ),
    });
  }

  // --- Batch actions -----------------------------------------------------------------------

  /**
   * Apply one action to many jobs in a **single** driver call.
   *
   * Each action maps to one guarded statement over the whole id set, so the cost is constant in the
   * number of ids and the guard is uniform: an id that didn't match (already gone, or an `ACTIVE` row
   * that a retry or a remove refuses) is simply absent from the result rather than failing the batch.
   * The previous implementation looped `requeueJob` per id inside one transaction, where the first
   * stale id threw and rolled back every retry beside it.
   *
   * Cancellation keeps its one non-transactional side effect: a job running *in this process* is
   * cancelled by firing its handler's `AbortSignal`, which no statement can undo, so those fire only
   * after the write has landed.
   */
  async runJobBatch(options: { jobIds: string[]; action: JobBatchAction }): Promise<BatchResult> {
    const { jobIds, action } = options;
    if (!jobIds.length) return { affected: 0, requested: 0 };
    assertBatchIds(jobIds, 'runJobBatch({ jobIds })');

    const now = this.runtime.clock.now();
    const driver = this.runtime.driver;

    switch (action) {
      case JobBatchAction.REMOVE: {
        const removed = await driver.removeJobs({ jobIds });
        this.emitPerJob(PortQueueEvent.JOB_REMOVED, removed);
        return { affected: removed.length, requested: jobIds.length };
      }
      case JobBatchAction.RETRY: {
        const requeued = await driver.requeueJobs({ jobIds, now });
        // One wakeup per distinct queue, not per job.
        for (const q of new Set(requeued.map((r) => r.queueName))) this.runtime.wakeup.signal(q);
        for (const ref of requeued) {
          this.runtime.events.emit(PortQueueEvent.JOB_ADDED, {
            jobId: ref.jobId,
            queue: ref.queueName,
            deduplicated: false,
          });
        }
        return { affected: requeued.length, requested: jobIds.length };
      }
      case JobBatchAction.CANCEL: {
        // Jobs running here can only be *asked* to stop — their handler owns the row's outcome — so
        // they are signalled and counted apart. Everything else is cancelled in one statement.
        //
        // No `JOB_CANCELLED` is emitted for a signalled job: cancellation is cooperative, and a
        // handler that ignores `job.signal` completes normally. Emitting it here told every listener
        // (and the dashboard's own toast) that three jobs had been cancelled when none had.
        const running = new Set(jobIds.filter((id) => this.isRunningHere(id)));
        const remaining = jobIds.filter((id) => !running.has(id));
        const cancelled = remaining.length
          ? await driver.cancelJobs({ jobIds: remaining, now })
          : [];
        for (const jobId of running) this.runtime.cancelRunning?.(jobId);
        this.emitPerJob(PortQueueEvent.JOB_CANCELLED, cancelled);
        return {
          affected: cancelled.length,
          requested: jobIds.length,
          ...(running.size ? { signalled: running.size } : {}),
        };
      }
      default:
        throw new InvalidOptionsError(`Unknown job batch action '${String(action)}'.`);
    }
  }

  /**
   * Emit one event per affected job, naming the queue the row actually belongs to.
   *
   * The ref comes from the statement that changed the row, so the queue is the row's own — which is
   * why a batch needs no `queue` argument, and why one request can carry a selection that spans
   * queues without any event naming the wrong one.
   */
  private emitPerJob(
    event: PortQueueEvent.JOB_REMOVED | PortQueueEvent.JOB_CANCELLED,
    refs: JobRef[],
  ): void {
    for (const ref of refs) {
      this.runtime.events.emit(event, { jobId: ref.jobId, queue: ref.queueName });
    }
  }

  /**
   * Remove many schedules in **one** statement, which also returns each removed row's queue — so the
   * `SCHEDULE_REMOVED` events cost nothing beyond the delete. This used to read every schedule
   * individually just to learn its queue name, then delete them one at a time: 2N queries for N ids.
   */
  async removeSchedules(options: { scheduleIds: string[] }): Promise<BatchResult> {
    const { scheduleIds } = options;
    if (!scheduleIds.length) return { affected: 0, requested: 0 };
    assertBatchIds(scheduleIds, 'removeSchedules({ scheduleIds })');
    const removed = await this.runtime.driver.deleteSchedules({ scheduleIds });
    for (const ref of removed) {
      this.runtime.events.emit(PortQueueEvent.SCHEDULE_REMOVED, {
        scheduleId: ref.scheduleId,
        queue: ref.queueName,
      });
    }
    return { affected: removed.length, requested: scheduleIds.length };
  }

  /** Arm or disarm a schedule. Core exposes the flag as read-only; the dashboard can toggle it. */
  async setScheduleEnabled(options: { scheduleId: string; enabled: boolean }): Promise<boolean> {
    // One statement: the driver returns the affected row's ref, so the event needs no extra read.
    const updated = await this.runtime.driver.setScheduleEnabled({
      scheduleId: options.scheduleId,
      enabled: options.enabled,
      now: this.runtime.clock.now(),
    });
    if (!updated) return false;
    this.runtime.events.emit(PortQueueEvent.SCHEDULE_UPDATED, {
      scheduleId: updated.scheduleId,
      queue: updated.queueName,
    });
    return true;
  }

  /** Whether this process is currently running the job (so a cancel fires its signal). */
  private isRunningHere(jobId: string): boolean {
    // `cancelRunning` both tests and acts, so it can't be used as a probe here without
    // cancelling. `isJobRunningHere` is the read-only half.
    return this.runtime.isJobRunningHere?.(jobId) ?? false;
  }
}

export type { JobRecord };
