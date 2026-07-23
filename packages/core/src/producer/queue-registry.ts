import type { Driver } from '../drivers/driver.interface.js';
import type { QueueRow } from '../jobs/job-record.js';
import type { QueueOptions } from '../options/queue-options.js';
import type { WorkflowStep } from '../jobs/job.js';
import type { Clock } from '../util/clock.js';

interface QueueEntry {
  row: QueueRow;
  options: QueueOptions;
  steps?: ReadonlyArray<WorkflowStep>;
}

/**
 * Caches queue name → id + in-memory options + workflow steps.
 * The name→id lookup (via idempotent `ensureQueue`) happens once per queue, so the hot
 * path stays single-table and join-free.
 */
export class QueueRegistry {
  private readonly entries = new Map<string, QueueEntry>();
  private readonly ensuring = new Map<string, Promise<QueueRow>>();

  constructor(
    private readonly driver: Driver,
    private readonly clock: Clock,
  ) {}

  /** Record in-memory options / workflow steps for a queue (no I/O). */
  define(name: string, options: QueueOptions, steps?: ReadonlyArray<WorkflowStep>): void {
    const existing = this.entries.get(name);
    if (existing) {
      existing.options = options;
      if (steps) existing.steps = steps;
      return;
    }
    // Merge into any pending entry so a later define() (e.g. from createQueue) never wipes
    // the workflow steps registered by createWorker.
    const pending = this.pendingOptions.get(name) ?? { options: {} };
    pending.options = options;
    if (steps) pending.steps = steps;
    this.pendingOptions.set(name, pending);
  }

  private readonly pendingOptions = new Map<
    string,
    { options: QueueOptions; steps?: ReadonlyArray<WorkflowStep> }
  >();

  getOptions(name: string): QueueOptions {
    return this.entries.get(name)?.options ?? this.pendingOptions.get(name)?.options ?? {};
  }

  /** The ordered workflow steps for a queue, if a workflow worker registered them. */
  getWorkflowSteps(name: string): ReadonlyArray<WorkflowStep> | undefined {
    return this.entries.get(name)?.steps ?? this.pendingOptions.get(name)?.steps;
  }

  /** Resolve (and cache) the queue row, ensuring it exists. Idempotent under concurrency. */
  async ensure(name: string): Promise<QueueRow> {
    const cached = this.entries.get(name);
    if (cached) return cached.row;
    const inflight = this.ensuring.get(name);
    if (inflight) return inflight;
    const pending = this.pendingOptions.get(name);
    const promise = this.driver
      .ensureQueue({
        name,
        ...(pending?.options ? { options: pending.options } : {}),
        now: this.clock.now(),
      })
      .then((row) => {
        this.entries.set(name, {
          row,
          options: pending?.options ?? {},
          ...(pending?.steps ? { steps: pending.steps } : {}),
        });
        this.pendingOptions.delete(name);
        this.ensuring.delete(name);
        return row;
      });
    this.ensuring.set(name, promise);
    return promise;
  }

  /** Refresh the cached pause flags for a queue (after pause/resume). */
  async refresh(name: string): Promise<QueueRow | null> {
    const row = await this.driver.getQueueByName({ name });
    const entry = this.entries.get(name);
    if (row && entry) entry.row = row;
    return row;
  }

  cachedRow(name: string): QueueRow | undefined {
    return this.entries.get(name)?.row;
  }

  /**
   * Whether this queue was declared in *this* process (via createQueue/createWorker), whether or
   * not its row has been ensured yet. Used to block manual queue removal of an in-use queue: a
   * running process that still references the queue must not have it deleted from under it.
   */
  isRegistered(name: string): boolean {
    return this.entries.has(name) || this.pendingOptions.has(name) || this.ensuring.has(name);
  }
}
