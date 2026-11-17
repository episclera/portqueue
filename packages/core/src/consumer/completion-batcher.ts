import { MAX_BATCH_IDS } from '../constants';
import type { CompletedJobInput, Driver } from '../drivers/driver.interface';
import type { Clock } from '../util/clock';

interface PendingSettle {
  job: CompletedJobInput;
  resolve: (settled: boolean) => void;
  reject: (error: unknown) => void;
}

/**
 * Coalesces job completions into batched `Driver.completeJobs` calls — a group commit.
 *
 * Settling one job is one statement, and a worker running many short handlers finishes hundreds of
 * them a second: one `UPDATE` each is the cost that dominates its throughput. Here every completion
 * issued in the same tick is queued and flushed together, and while a flush is in flight the next
 * batch keeps filling, so the batch size tracks the database's own latency: a fast database settles
 * small batches often, a slow one fewer, larger ones. A flush never carries more than
 * {@link MAX_BATCH_IDS} jobs.
 *
 * Nothing about a settle's meaning changes. Every caller awaits its own job's answer, and the
 * driver fences each row on its own claim token exactly as the singular settle does, so a stale run
 * still learns it lost its claim and the rest of its batch is unaffected. A driver without
 * `completeJobs` (a custom one written against the singular) is called once per job instead.
 */
export class CompletionBatcher {
  private pending: PendingSettle[] = [];
  private scheduled = false;
  private flushing = false;

  constructor(
    private readonly driver: Driver,
    private readonly clock: Clock,
  ) {}

  /** Settle one claimed job as `COMPLETED`; resolves with whether the row was actually settled. */
  complete(job: CompletedJobInput): Promise<boolean> {
    if (!this.driver.completeJobs) {
      return this.driver.completeJob({ ...job, now: this.clock.now() });
    }
    return new Promise<boolean>((resolve, reject) => {
      this.pending.push({ job, resolve, reject });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.scheduled || this.flushing) return;
    this.scheduled = true;
    // `setImmediate`, not a microtask: it lets every handler that finishes in this turn of the event
    // loop join the batch, and it never waits on a timer.
    setImmediate(() => {
      this.scheduled = false;
      void this.flush();
    });
  }

  private async flush(): Promise<void> {
    this.flushing = true;
    try {
      while (this.pending.length) {
        const batch = this.pending.splice(0, MAX_BATCH_IDS);
        try {
          const settled = new Set(
            await this.driver.completeJobs!({
              jobs: batch.map((entry) => entry.job),
              now: this.clock.now(),
            }),
          );
          for (const entry of batch) entry.resolve(settled.has(entry.job.jobId));
        } catch (error) {
          for (const entry of batch) entry.reject(error);
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
