import { FINISHED_STATUSES, JobStatus } from '../jobs/job-state.enum.js';
import type { Runtime } from '../client/runtime.js';

/**
 * Hard-deletes finished jobs per retention policy, in bounded batches (build_plan/06.9).
 * Default is keep-forever; only jobs whose resolved retention is DELETE_AFTER and whose TTL
 * has elapsed are removed. Cluster-coordinated by running on the same interval tick.
 */
export class RetentionService {
  private readonly batchSize = 500;

  constructor(private readonly runtime: Runtime) {}

  async sweep(): Promise<number> {
    const now = this.runtime.clock.now();
    let total = 0;
    // Bounded batches so the table is never long-locked.
    for (let i = 0; i < 20; i += 1) {
      const removed = await this.runtime.driver.deleteFinishedJobs({
        olderThan: now,
        statuses: FINISHED_STATUSES as JobStatus[],
        limit: this.batchSize,
        now,
      });
      total += removed;
      if (removed < this.batchSize) break;
    }
    if (total > 0) this.runtime.logger.debug(`Retention removed ${total} finished jobs.`);
    return total;
  }
}
