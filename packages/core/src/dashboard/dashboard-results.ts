/**
 * Result and query shapes for the `pq._dashboard` facade. These are **not** part of the public
 * developer API — they exist so `@portqueue/dashboard` can ask for exactly what it renders
 * without widening `PortQueue`. See the facade invariant in CLAUDE.md.
 */
import type { JobStatus } from '../jobs/job-state.enum';
import type { Page } from '../options/common';
import type { InstanceInfo, QueueInfo, ScheduleInfo } from '../producer/results';

export type { Page };

/** The paging window every dashboard list read accepts. */
export interface DashboardPageQuery {
  /** Rows to return. Clamped to {@link DASHBOARD_MAX_LIMIT}. */
  limit?: number;
  offset?: number;
}

/** Hard ceiling on a dashboard page, so a crafted `limit` can't ask for the whole table. */
export const DASHBOARD_MAX_LIMIT = 200;

/** Pause-state narrowing shared by the queue and instance lists. */
export interface PausedFilter {
  /** `true` → only paused rows, `false` → only running ones, absent → both. */
  processingPaused?: boolean;
}

export interface GetQueuesQuery extends DashboardPageQuery, PausedFilter {
  /** Case-insensitive substring of the queue name. */
  search?: string;
  /**
   * Narrow by whether the **host** process declares the queue (`createQueue`/`createWorker`).
   * Resolved in memory against this process's registry, since it isn't a stored column.
   */
  inUse?: boolean;
}

export interface GetInstancesQuery extends DashboardPageQuery, PausedFilter {
  /** Case-insensitive substring of the instance key. */
  search?: string;
  /** `true` → only instances inside the liveness window, `false` → only stale ones. */
  alive?: boolean;
}

export interface GetSchedulesQuery extends DashboardPageQuery {
  queue?: string;
  enabled?: boolean;
  /** Case-insensitive substring matched against the schedule id, queue name and cron pattern. */
  search?: string;
}

/** A schedule plus the queue it belongs to — the schedules table shows both. */
export interface ScheduleWithQueue extends ScheduleInfo {
  queue: string;
}

/**
 * Counts only. The dashboard renders per-status activity cards and nothing else, so this
 * deliberately carries no derived rate metrics.
 */
export interface DashboardStats {
  queue?: string;
  counts: Record<JobStatus, number>;
}

/** The fields a dashboard job search scans beyond the ones a filter already covers. */
export interface JobSearchQuery {
  /**
   * Free-text term matched against the job id, status, idempotency key, failure message and the
   * serialized payload. Case-insensitive substring.
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
 * was already gone, or one the action refused (removing an ACTIVE row), is simply not counted.
 */
export interface BatchResult {
  affected: number;
  /** How many ids were submitted, so a caller can report "3 of 5 removed". */
  requested: number;
}

export type { InstanceInfo, QueueInfo, ScheduleInfo };
