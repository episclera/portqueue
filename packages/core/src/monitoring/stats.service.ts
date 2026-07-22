import { JobStatus } from '../jobs/job-state.enum.js';
import { toSnapshot } from '../jobs/snapshot.js';
import type { Runtime } from '../client/runtime.js';
import type {
  GetJobsQuery,
  JobSnapshot,
  Page,
  QueueInfo,
  QueueStats,
  WorkflowSnapshot,
} from '../producer/results.js';

/**
 * Read-side aggregations for the API, dashboard, and CLI (build_plan/10.5). Resolves a
 * job's queue name via a separate keyed lookup / the per-instance cache — never a JOIN.
 */
export class ReadService {
  constructor(private readonly runtime: Runtime) {}

  private async queueNameById(queueId: string): Promise<string> {
    // Prefer the per-instance cache; fall back to a keyed single-table lookup.
    for (const q of await this.runtime.driver.listQueues()) {
      if (q.id === queueId) return q.name;
    }
    return queueId;
  }

  async getJob<TData = unknown>(jobId: string): Promise<JobSnapshot<TData> | null> {
    const record = await this.runtime.driver.getJob({ jobId });
    if (!record) return null;
    return toSnapshot<TData>(
      record,
      await this.queueNameById(record.queueId),
      this.runtime.clock.now(),
    );
  }

  async getJobs<TData = unknown>(query: GetJobsQuery): Promise<Page<JobSnapshot<TData>>> {
    const limit = Math.min(query.limit ?? 50, 500);
    const offset = query.cursor
      ? Number(Buffer.from(query.cursor, 'base64').toString('utf8')) || 0
      : 0;
    let queueId: string | undefined;
    if (query.queue) queueId = (await this.runtime.registry.ensure(query.queue)).id;
    const records = await this.runtime.driver.getJobs({
      ...(queueId ? { queueId } : {}),
      ...(query.statuses ? { statuses: query.statuses } : {}),
      ...(query.scheduleId ? { scheduleId: query.scheduleId } : {}),
      ...(query.workflowId ? { workflowId: query.workflowId } : {}),
      limit: limit + 1,
      offset,
      order: query.order ?? 'desc',
    });
    const hasMore = records.length > limit;
    const page = records.slice(0, limit);
    const now = this.runtime.clock.now();
    const nameCache = new Map<string, string>();
    const items: JobSnapshot<TData>[] = [];
    for (const r of page) {
      let name = nameCache.get(r.queueId);
      if (!name) {
        name = query.queue ?? (await this.queueNameById(r.queueId));
        nameCache.set(r.queueId, name);
      }
      items.push(toSnapshot<TData>(r, name, now));
    }
    return {
      items,
      cursor: hasMore ? Buffer.from(String(offset + limit)).toString('base64') : null,
      hasMore,
    };
  }

  async getWorkflow(workflowId: string): Promise<WorkflowSnapshot | null> {
    const records = await this.runtime.driver.getJobs({
      workflowId,
      limit: 1000,
      offset: 0,
      order: 'asc',
    });
    if (!records.length) return null;
    const now = this.runtime.clock.now();
    const queue = await this.queueNameById(records[0]!.queueId);
    return {
      workflowId,
      queue,
      steps: records.map((r) => toSnapshot(r, queue, now)),
    };
  }

  async getQueueStats(queue?: string): Promise<QueueStats> {
    let queueId: string | undefined;
    if (queue) queueId = (await this.runtime.registry.ensure(queue)).id;
    const counts = await this.runtime.driver.countJobsByStatus(queueId ? { queueId } : {});
    const now = this.runtime.clock.now();
    const points = await this.runtime.driver.getThroughput({
      ...(queueId ? { queueId } : {}),
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
      const counts = await this.runtime.driver.countJobsByStatus({ queueId: row.id });
      out.push({
        name: row.name,
        processingPaused: row.processingPaused,
        acceptingPaused: row.acceptingPaused,
        counts,
      });
    }
    return out;
  }
}

export { JobStatus };
