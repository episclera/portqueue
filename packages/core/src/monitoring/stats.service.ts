import { JobStatus } from '../jobs/job-state.enum';
import { toSnapshot } from '../jobs/snapshot';
import type { Runtime } from '../client/runtime';
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
   * A page of jobs, newest first. `instanceKey` is not part of the public `GetJobsQuery` — it is
   * here for the dashboard facade's instance detail view, which reads jobs by the instance that
   * claimed them.
   */
  async getJobs<TData = unknown>(
    query: GetJobsQuery & { instanceKey?: string },
  ): Promise<Page<JobSnapshot<TData>>> {
    const limit = Math.min(query.limit ?? 50, 500);
    const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
    const filter = {
      ...(query.queue ? { queueName: query.queue } : {}),
      ...(query.statuses ? { statuses: query.statuses } : {}),
      ...(query.scheduleId ? { scheduleId: query.scheduleId } : {}),
      ...(query.instanceKey ? { processedOnInstanceKey: query.instanceKey } : {}),
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
    const limit = Math.min(query.limit ?? 50, 500);
    const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
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
      items: rows.map((row) => ({
        name: row.name,
        processingPaused: row.processingPaused,
        acceptingPaused: row.acceptingPaused,
        counts: counts[row.name] ?? emptyStatusCounts(),
        inUse: this.runtime.registry.isRegistered(row.name),
      })),
      total,
    };
  }

  /** One queue by name, with the same counts and `inUse` flag the list carries. Null if unknown. */
  async getQueue(name: string): Promise<QueueInfo | null> {
    const row = await this.runtime.driver.getQueueByName({ name });
    if (!row) return null;
    const counts = await this.runtime.driver.countJobsByStatusPerQueue({ queueNames: [row.name] });
    return {
      name: row.name,
      processingPaused: row.processingPaused,
      acceptingPaused: row.acceptingPaused,
      counts: counts[row.name] ?? emptyStatusCounts(),
      inUse: this.runtime.registry.isRegistered(row.name),
    };
  }

  /**
   * A page of instances with liveness and per-instance job attribution, plus the total across
   * every page. Same `limit`/`offset` window as the job and schedule reads.
   */
  async getInstances(query: GetInstancesQuery = {}): Promise<Page<InstanceInfo>> {
    const limit = Math.min(query.limit ?? 50, 500);
    const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
    const [rows, total] = await Promise.all([
      this.runtime.driver.listInstances({ limit, offset }),
      this.runtime.driver.countInstances(),
    ]);
    if (!rows.length) return { items: [], total };
    const now = this.runtime.clock.now();
    const staleAfter = (this.runtime.options.instance?.heartbeatIntervalSeconds ?? 15) * 3 * 1000;
    // One grouped count for the whole page rather than a query per instance.
    const counts = await this.runtime.driver.countJobsByStatusPerInstance({
      instanceKeys: rows.map((r) => r.instanceKey),
    });
    return {
      items: rows.map((row) => ({
        instanceKey: row.instanceKey,
        processingPaused: row.processingPaused,
        alive: row.lastSeenAt >= now - staleAfter,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
        lastSeenAt: new Date(row.lastSeenAt),
        cpuPercent: row.cpuPercent,
        memoryPercent: row.memoryPercent,
        counts: counts[row.instanceKey] ?? emptyStatusCounts(),
      })),
      total,
    };
  }

  /** One instance by key, with the same liveness, health and attribution the list carries. */
  async getInstance(instanceKey: string): Promise<InstanceInfo | null> {
    const row = await this.runtime.driver.getInstance({ instanceKey });
    if (!row) return null;
    const now = this.runtime.clock.now();
    const staleAfter = (this.runtime.options.instance?.heartbeatIntervalSeconds ?? 15) * 3 * 1000;
    const counts = await this.runtime.driver.countJobsByStatusPerInstance({
      instanceKeys: [row.instanceKey],
    });
    return {
      instanceKey: row.instanceKey,
      processingPaused: row.processingPaused,
      alive: row.lastSeenAt >= now - staleAfter,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      lastSeenAt: new Date(row.lastSeenAt),
      cpuPercent: row.cpuPercent,
      memoryPercent: row.memoryPercent,
      counts: counts[row.instanceKey] ?? emptyStatusCounts(),
    };
  }
}

/** A zeroed status breakdown, for a key the grouped count query returned nothing for. */
function emptyStatusCounts(): Record<JobStatus, number> {
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

export { JobStatus };
