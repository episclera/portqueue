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

  async getJobs<TData = unknown>(query: GetJobsQuery): Promise<Page<JobSnapshot<TData>>> {
    const limit = Math.min(query.limit ?? 50, 500);
    const offset = query.cursor
      ? Number(Buffer.from(query.cursor, 'base64').toString('utf8')) || 0
      : 0;
    const records = await this.runtime.driver.getJobs({
      ...(query.queue ? { queueName: query.queue } : {}),
      ...(query.statuses ? { statuses: query.statuses } : {}),
      ...(query.scheduleId ? { scheduleId: query.scheduleId } : {}),
      limit: limit + 1,
      offset,
      order: query.order ?? 'desc',
    });
    const hasMore = records.length > limit;
    const page = records.slice(0, limit);
    const now = this.runtime.clock.now();
    const items = page.map((r) => toSnapshot<TData>(r, r.queueName, now));
    return {
      items,
      cursor: hasMore ? Buffer.from(String(offset + limit)).toString('base64') : null,
      hasMore,
    };
  }

  async getQueueStats(queue?: string): Promise<QueueStats> {
    const counts = await this.runtime.driver.countJobsByStatus(queue ? { queueName: queue } : {});
    const now = this.runtime.clock.now();
    const points = await this.runtime.driver.getThroughput({
      ...(queue ? { queueName: queue } : {}),
      sinceMs: now - 3_600_000,
      now,
    });
    let completed = 0;
    let failed = 0;
    for (const p of points) {
      completed += p.completed;
      failed += p.failed;
    }
    const minutes = 60;
    return {
      ...(queue ? { queue } : {}),
      counts,
      throughputPerMinute: completed / minutes,
      failureRate: completed + failed === 0 ? 0 : failed / (completed + failed),
    };
  }

  async getQueues(): Promise<QueueInfo[]> {
    const rows = await this.runtime.driver.listQueues();
    const out: QueueInfo[] = [];
    for (const row of rows) {
      const counts = await this.runtime.driver.countJobsByStatus({ queueName: row.name });
      out.push({
        name: row.name,
        processingPaused: row.processingPaused,
        acceptingPaused: row.acceptingPaused,
        counts,
        inUse: this.runtime.registry.isRegistered(row.name),
      });
    }
    return out;
  }

  /** Instance overview with liveness + per-instance job attribution. */
  async getInstances(): Promise<InstanceInfo[]> {
    const rows = await this.runtime.driver.listInstances();
    const now = this.runtime.clock.now();
    const staleAfter = (this.runtime.options.instance?.heartbeatIntervalMs ?? 15000) * 3;
    const out: InstanceInfo[] = [];
    for (const row of rows) {
      const counts = await this.runtime.driver.countJobsByStatus({
        processedOnInstanceKey: row.instanceKey,
      });
      out.push({
        instanceKey: row.instanceKey,
        processingPaused: row.processingPaused,
        alive: row.lastSeenAt >= now - staleAfter,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
        lastSeenAt: new Date(row.lastSeenAt),
        counts,
      });
    }
    return out;
  }
}

export { JobStatus };
