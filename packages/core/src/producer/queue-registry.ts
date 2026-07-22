import type { Driver } from '../driver/driver.interface.js';
import type { QueueRow } from '../jobs/job-record.js';
import type { QueueOptions } from '../options/queue-options.js';
import type { WorkflowDefinition } from '../jobs/job.js';
import type { Clock } from '../util/clock.js';

interface QueueEntry {
  row: QueueRow;
  options: QueueOptions;
  workflow?: WorkflowDefinition;
}

/**
 * Caches queue name → id + in-memory options + workflow definition (build_plan/04.3).
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

  /** Record in-memory options / workflow for a queue (no I/O). */
  define(name: string, options: QueueOptions, workflow?: WorkflowDefinition): void {
    const existing = this.entries.get(name);
    if (existing) {
      existing.options = options;
      if (workflow) existing.workflow = workflow;
      return;
    }
    // Merge into any pending entry so a later define() (e.g. from createWorker) never wipes
    // a previously-registered workflow definition.
    const pending = this.pendingOptions.get(name) ?? { options: {} };
    pending.options = options;
    if (workflow) pending.workflow = workflow;
    this.pendingOptions.set(name, pending);
  }

  private readonly pendingOptions = new Map<
    string,
    { options: QueueOptions; workflow?: WorkflowDefinition }
  >();

  getOptions(name: string): QueueOptions {
    return this.entries.get(name)?.options ?? this.pendingOptions.get(name)?.options ?? {};
  }

  getWorkflow(name: string): WorkflowDefinition | undefined {
    return this.entries.get(name)?.workflow ?? this.pendingOptions.get(name)?.workflow;
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
          ...(pending?.workflow ? { workflow: pending.workflow } : {}),
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
}
