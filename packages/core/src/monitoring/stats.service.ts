import { JobStatus } from '../jobs/job-state.enum';
import { toSnapshot } from '../jobs/snapshot';
import { secondsToMs } from '../util/seconds';
import {
  DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
  DEFAULT_PAGE_LIMIT,
  HEARTBEAT_STALE_BEATS,
  MAX_PAGE_LIMIT,
} from '../constants';
import type { Runtime } from '../client/runtime';
import type { InstanceRow, QueueRow } from '../jobs/job-record';
import type { JobListFilter } from '../drivers/driver.interface';
import type { PortQueueOptions } from '../options/client-options';
import type {
  GetInstancesQuery,
  GetJobsQuery,
  GetQueuesQuery,
  InstanceInfo,
  JobSnapshot,
  Page,
  QueueInfo,
  QueueStats,
} from '../producer/results';

/**
 * How long an instance may go unheard-from before it counts as stale: {@link HEARTBEAT_STALE_BEATS}
 * heartbeats, so a single missed beat (a slow query, a GC pause) doesn't flip a healthy instance.
 *
 * Exported because the dashboard facade needs the identical window to build the same `alive` flag —
 * this policy used to live as a literal `15` and a literal `× 3` in four separate files.
 */
export function instanceStaleAfterMs(options: PortQueueOptions): number {
  const beatSeconds =
    options.instance?.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS;
  return secondsToMs(beatSeconds * HEARTBEAT_STALE_BEATS, 'instance.heartbeatIntervalSeconds');
}

/** A zeroed status breakdown, for a key a grouped count query returned nothing for. */
export function emptyStatusCounts(): Record<JobStatus, number> {
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
 * Map an `instance` row to the public {@link InstanceInfo}. One mapper, used by both the public read
 * and the dashboard facade — the two used to build byte-identical objects from their own copies of
 * the same liveness arithmetic.
 */
export function toInstanceInfo(
  row: InstanceRow,
  counts: Record<JobStatus, number> | undefined,
  seenSince: number,
): InstanceInfo {
  return {
    instanceKey: row.instanceKey,
    processingPaused: row.processingPaused,
    alive: row.lastSeenAt >= seenSince,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    lastSeenAt: new Date(row.lastSeenAt),
    cpuPercent: row.cpuPercent,
    memoryPercent: row.memoryPercent,
    counts: counts ?? emptyStatusCounts(),
  };
}

/** Map a `queue` row to the public {@link QueueInfo}. */
export function toQueueInfo(
  row: QueueRow,
  counts: Record<JobStatus, number> | undefined,
  inUse: boolean,
): QueueInfo {
  return {
    name: row.name,
    processingPaused: row.processingPaused,
    acceptingPaused: row.acceptingPaused,
    counts: counts ?? emptyStatusCounts(),
    inUse,
  };
}

/** Clamp a caller-supplied page window to something the database is happy to serve. */
export function pageWindow(
  query: { limit?: number; offset?: number },
  maxLimit = MAX_PAGE_LIMIT,
): { limit: number; offset: number } {
  return {
    limit: Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_PAGE_LIMIT), 1), maxLimit),
    offset: Math.max(Math.trunc(query.offset ?? 0), 0),
  };
}

/**
 * Read-side aggregations for the API, dashboard, and CLI. A job carries its
 * `queueName` directly, so there is no id→name lookup and never a JOIN.
 */
export class ReadService {
  constructor(private readonly runtime: Runtime) {}

  async getJob<TData = unknown>(jobId: string): Promise<JobSnapshot<TData> | null> {
    const record = await this.runtime.driver.getJob({ jobId });
    if (!record) return null;
    return toSnapshot<TData>(record, record.queueName, this.runtime.clock.now());
  }

  /**
   * A page of jobs, newest first.
   *
   * `instanceKey` and `search` are not part of the public `GetJobsQuery` — they are here for the
   * dashboard facade, whose instance detail view reads jobs by the instance that claimed them and
   * whose table offers a free-text filter. Both are pushed into SQL, so a search pages in the
   * database rather than streaming the table into this process.
   */
  async getJobs<TData = unknown>(
    query: GetJobsQuery & { instanceKey?: string; search?: string },
  ): Promise<Page<JobSnapshot<TData>>> {
    const { limit, offset } = pageWindow(query);
    const filter: JobListFilter = {
      ...(query.queue ? { queueName: query.queue } : {}),
      ...(query.statuses ? { statuses: query.statuses } : {}),
      ...(query.scheduleId ? { scheduleId: query.scheduleId } : {}),
      ...(query.instanceKey ? { processedOnInstanceKey: query.instanceKey } : {}),
      ...(query.search ? { search: query.search } : {}),
    };
    const records = await this.runtime.driver.getJobs({
      ...filter,
      limit: limit + 1,
      offset,
    });
    // Over-fetching one row is what tells us whether anything follows this page — and whenever
    // nothing does, it also pins the total, so the extra COUNT is only paid when it has to be.
    const hasMore = records.length > limit;
    const page = records.slice(0, limit);
    const total = hasMore ? await this.runtime.driver.countJobs(filter) : offset + page.length;
    const now = this.runtime.clock.now();
    return { items: page.map((r) => toSnapshot<TData>(r, r.queueName, now)), total };
  }

  async getQueueStats(queue?: string): Promise<QueueStats> {
    const counts = await this.runtime.driver.countJobsByStatus(queue ? { queueName: queue } : {});
    return { ...(queue ? { queue } : {}), counts };
  }

  /**
   * A page of queues with their per-status counts, plus the total across every page. Same
   * `limit`/`offset` window as the job, schedule and instance reads.
   */
  async getQueues(query: GetQueuesQuery = {}): Promise<Page<QueueInfo>> {
    const { limit, offset } = pageWindow(query);
    const [rows, total] = await Promise.all([
      this.runtime.driver.listQueues({ limit, offset }),
      this.runtime.driver.countQueues(),
    ]);
    if (!rows.length) return { items: [], total };
    // One grouped count for the whole page rather than a query per queue.
    const counts = await this.runtime.driver.countJobsByStatusPerQueue({
      queueNames: rows.map((r) => r.name),
    });
    return {
      items: rows.map((row) =>
        toQueueInfo(row, counts[row.name], this.runtime.registry.isRegistered(row.name)),
      ),
      total,
    };
  }

  /** One queue by name, with the same counts and `inUse` flag the list carries. Null if unknown. */
  async getQueue(name: string): Promise<QueueInfo | null> {
    const row = await this.runtime.driver.getQueueByName({ name });
    if (!row) return null;
    const counts = await this.runtime.driver.countJobsByStatusPerQueue({ queueNames: [row.name] });
    return toQueueInfo(row, counts[row.name], this.runtime.registry.isRegistered(row.name));
  }

  /**
   * A page of instances with liveness and per-instance job attribution, plus the total across
   * every page. Same `limit`/`offset` window as the job and schedule reads.
   */
  async getInstances(query: GetInstancesQuery = {}): Promise<Page<InstanceInfo>> {
    const { limit, offset } = pageWindow(query);
    const [rows, total] = await Promise.all([
      this.runtime.driver.listInstances({ limit, offset }),
      this.runtime.driver.countInstances(),
    ]);
    if (!rows.length) return { items: [], total };
    const seenSince = this.runtime.clock.now() - instanceStaleAfterMs(this.runtime.options);
    // One grouped count for the whole page rather than a query per instance.
    const counts = await this.runtime.driver.countJobsByStatusPerInstance({
      instanceKeys: rows.map((r) => r.instanceKey),
    });
    return {
      items: rows.map((row) => toInstanceInfo(row, counts[row.instanceKey], seenSince)),
      total,
    };
  }

  /** One instance by key, with the same liveness, health and attribution the list carries. */
  async getInstance(instanceKey: string): Promise<InstanceInfo | null> {
    const row = await this.runtime.driver.getInstance({ instanceKey });
    if (!row) return null;
    const seenSince = this.runtime.clock.now() - instanceStaleAfterMs(this.runtime.options);
    const counts = await this.runtime.driver.countJobsByStatusPerInstance({
      instanceKeys: [row.instanceKey],
    });
    return toInstanceInfo(row, counts[row.instanceKey], seenSince);
  }
}

export { JobStatus };
