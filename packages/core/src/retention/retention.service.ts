import { RETENTION_BATCH_SIZE, RETENTION_MAX_BATCHES } from '../constants';
import type { Runtime } from '../client/runtime';

/**
 * Hard-deletes finished jobs per retention policy, in bounded batches. Default is keep-forever; only
 * jobs whose resolved retention is DELETE_AFTER and whose TTL has elapsed are removed.
 * Cluster-coordinated by running on the same interval tick.
 *
 * **Which statuses a job may be deleted in is the job's own setting**, not this sweeper's. The
 * caller's `retention.statuses` is resolved per job and frozen onto its row, so this passes no status
 * list at all — which is what makes `statuses: [COMPLETED]` really leave the failed jobs alone, where
 * a sweeper that always passed every finished status deleted them too.
 */
export class RetentionService {
  constructor(private readonly runtime: Runtime) {}

  async sweep(): Promise<number> {
    const now = this.runtime.clock.now();
    let total = 0;
    // Bounded batches so the table is never long-locked.
    for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch += 1) {
      const removed = await this.runtime.driver.deleteFinishedJobs({
        olderThan: now,
        limit: RETENTION_BATCH_SIZE,
      });
      total += removed;
      if (removed < RETENTION_BATCH_SIZE) break;
    }
    if (total > 0) this.runtime.logger.debug(`Retention removed ${total} finished jobs.`);
    return total;
  }
}
