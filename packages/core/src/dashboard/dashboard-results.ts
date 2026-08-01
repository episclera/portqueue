/**
 * Result and query shapes for the `pq._dashboard` facade. These are **not** part of the public
 * developer API — they exist so `@portqueue/dashboard` can ask for exactly what it renders
 * without widening `PortQueue`. See the facade invariant in CLAUDE.md.
 */
import type { JobStatus } from '../jobs/job-state.enum';
import type { Page } from '../options/common';
import type { GetSchedulesQuery, InstanceInfo, QueueInfo, ScheduleInfo } from '../producer/results';

export type { Page };

/** The paging window every dashboard list read accepts. */
export interface DashboardPageQuery {
  /** Rows to return. Clamped to `DASHBOARD_MAX_PAGE_LIMIT`. */
  limit?: number;
  offset?: number;
}

/** Pause-state narrowing shared by the queue and instance lists. */
export interface PausedFilter {
  /** `true` → only paused rows, `false` → only running ones, absent → both. */
  processingPaused?: boolean;
}

/**
 * The dashboard's queue query. Named for the facade, but the same shape as the public
 * `GetQueuesQuery` — the search and pause-state narrowings started here and were promoted, since a
 * developer looking for paused queues needed them just as much. The facade keeps the name (and the
 * tighter page ceiling); it no longer keeps a second implementation.
 *
 * There is deliberately no `inUse` filter. `inUse` means "declared in the process that produced this
 * info", and the dashboard runs on its own headless client (`createDashboard({ driver })`) rather
 * than riding on the application's — so it has no way to know which queues the workers declare, and a
 * filter that always answered "none" would be worse than no filter.
 */
export interface DashboardQueuesQuery extends DashboardPageQuery, PausedFilter {
  /** Case-insensitive substring of the queue name. */
  search?: string;
}

/** The dashboard's instance query — the public `GetInstancesQuery` under the facade's own name. */
export interface DashboardInstancesQuery extends DashboardPageQuery, PausedFilter {
  /** Case-insensitive substring of the instance key. */
  search?: string;
  /** `true` → only instances inside the liveness window, `false` → only stale ones. */
  alive?: boolean;
}

/**
 * The dashboard's schedule query: the public {@link GetSchedulesQuery} (paging, `queue`, `enabled`)
 * plus the free-text filter only the dashboard's table offers.
 */
export interface DashboardSchedulesQuery extends GetSchedulesQuery {
  /** Case-insensitive substring matched against the schedule id, queue name and cron pattern. */
  search?: string;
}

/**
 * Counts only. The dashboard renders per-status activity cards and nothing else, so this
 * deliberately carries no derived rate metrics.
 */
export interface DashboardStats {
  queue?: string;
  counts: Record<JobStatus, number>;
}

/** The free-text filter the dashboard's jobs table offers. */
export interface JobSearchQuery {
  /**
   * Free-text term matched against the job id, status, idempotency key, failure message and the
   * serialized payload. Case-insensitive substring, matched **in SQL** — so a search is a paged
   * query like any other read, not a scan of the table through this process.
   */
  search?: string;
}

/**
 * Narrow a job read to the instance that claimed the rows (`processed_on_instance_key`). Lives on
 * the facade rather than the public `GetJobsQuery`: it backs the instance detail page's "jobs
 * processed here" table, which is a dashboard view, not something the public read surface promises.
 */
export interface JobInstanceFilter {
  instanceKey?: string;
}

/** What a bulk row action does to each selected job. */
export enum JobBatchAction {
  RETRY = 'RETRY',
  CANCEL = 'CANCEL',
  REMOVE = 'REMOVE',
}

/**
 * The outcome of a batch. `affected` counts the rows the action actually changed — a job that
 * was already gone, or one the action refused (retrying or removing an ACTIVE row), is simply not
 * counted.
 */
export interface BatchResult {
  affected: number;
  /** How many ids were submitted, so a caller can report "3 of 5 removed". */
  requested: number;
  /**
   * Jobs a cancel could only *ask* to stop: they are running in this process, so their handler's
   * `AbortSignal` was fired and their row will settle to whatever the handler does next. Counted
   * apart from `affected` because nothing has been cancelled yet — reporting them as cancelled is
   * how the dashboard used to claim "Cancelled 3 jobs" for three jobs that then completed normally.
   */
  signalled?: number;
}

export type { InstanceInfo, QueueInfo, ScheduleInfo };
