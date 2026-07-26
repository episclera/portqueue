import { JobStatus } from '../jobs/job-state.enum';
import { toSnapshot } from '../jobs/snapshot';
import type { Runtime } from '../client/runtime';
import type {
  GetJobsQuery,
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
   * A page of jobs. `instanceKey` is not part of the public `GetJobsQuery` — it is here for the
   * dashboard facade's instance detail view, which reads jobs by the instance that claimed them.
   */
  async getJobs<TData = unknown>(
    query: GetJobsQuery & { instanceKey?: string },
  ): Promise<Page<JobSnapshot<TData>>> {
    const limit = Math.min(query.limit ?? 50, 500);
    // An explicit offset wins; otherwise decode the cursor (which encodes the next offset).
    const offset =
      query.offset !== undefined
        ? Math.max(Math.trunc(query.offset), 0)
        : query.cursor
          ? Number(Buffer.from(query.cursor, 'base64').toString('utf8')) || 0
          : 0;
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
      order: query.order ?? 'desc',
    });
    const hasMore = records.length > limit;
    const page = records.slice(0, limit);
    // The limit+1 over-fetch already pins the total whenever nothing follows this page, so the
    // extra COUNT is only paid when there genuinely are rows beyond it.
    const total = hasMore ? await this.runtime.driver.countJobs(filter) : offset + page.length;
    const now = this.runtime.clock.now();
    const items = page.map((r) => toSnapshot<TData>(r, r.queueName, now));
    return {
      items,
      cursor: hasMore ? Buffer.from(String(offset + limit)).toString('base64') : null,
      hasMore,
      total,
    };
  }

  async getQueueStats(queue?: string): Promise<QueueStats> {
    const counts = await this.runtime.driver.countJobsByStatus(queue ? { queueName: queue } : {});
    return { ...(queue ? { queue } : {}), counts };
  }

  async getQueues(): Promise<QueueInfo[]> {
    const rows = await this.runtime.driver.listQueues();
    if (!rows.length) return [];
    // One grouped count for the whole list rather than a query per queue.
    const counts = await this.runtime.driver.countJobsByStatusPerQueue({
      queueNames: rows.map((r) => r.name),
    });
    return rows.map((row) => ({
      name: row.name,
      processingPaused: row.processingPaused,
      acceptingPaused: row.acceptingPaused,
      counts: counts[row.name] ?? emptyStatusCounts(),
      inUse: this.runtime.registry.isRegistered(row.name),
    }));
  }

  /** Instance overview with liveness + per-instance job attribution. */
  async getInstances(): Promise<InstanceInfo[]> {
    const rows = await this.runtime.driver.listInstances();
    if (!rows.length) return [];
    const now = this.runtime.clock.now();
    const staleAfter = (this.runtime.options.instance?.heartbeatIntervalSeconds ?? 15) * 3 * 1000;
    const counts = await this.runtime.driver.countJobsByStatusPerInstance({
      instanceKeys: rows.map((r) => r.instanceKey),
    });
    return rows.map((row) => ({
      instanceKey: row.instanceKey,
      processingPaused: row.processingPaused,
      alive: row.lastSeenAt >= now - staleAfter,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      lastSeenAt: new Date(row.lastSeenAt),
      cpuPercent: row.cpuPercent,
      memoryPercent: row.memoryPercent,
      rssBytes: row.rssBytes,
      counts: counts[row.instanceKey] ?? emptyStatusCounts(),
    }));
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
