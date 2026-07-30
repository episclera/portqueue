import { secondsToMs } from '../util/seconds';
import { DEFAULT_TICK_INTERVAL_SECONDS } from '../constants';
import { QueueNotFoundError } from '../errors/errors';
import type { Driver } from '../drivers/driver.interface';
import type { QueueRow } from '../jobs/job-record';
import type { QueueOptions } from '../options/queue-options';
import type { Clock } from '../util/clock';

interface QueueEntry {
  row: QueueRow;
  options: QueueOptions;
  /** When the cached pause flags were last read from the database. */
  refreshedAt: number;
}

/**
 * Caches queue name → row + in-memory options, and owns the cached pause flags the claim loop reads.
 *
 * Three things this class is deliberate about:
 *
 * - **`declare` is only ever reached from the developer's own `createQueue`.** Declared options are
 *   *replaced*, because `createQueue` is a declaration: the caller states what the queue is, and the
 *   last declaration wins. That is only safe because nothing internal calls it — no admin action, no
 *   pause, no read path — so a `pauseQueue` can never blank the defaults a `createQueue` set.
 * - **The pause flags are cached with a TTL, not re-read per claim.** The claim loop used to issue a
 *   `getQueueByName` on every pump — per worker, per poll, and again on every freed concurrency slot
 *   — which on an idle queue meant more queue reads than job claims. They are refreshed on the
 *   maintenance tick (and immediately by a pause/resume made here), and {@link pauseState} answers
 *   from cache with no I/O at all.
 * - **A headless registry never writes.** For the dashboard and CLI (see `PortQueueOptions._headless`)
 *   `declare` is a no-op, `ensure` reads the row instead of creating it, and `isRegistered` is always
 *   false — an admin tool must not create queue rows or claim ownership of a queue it merely inspects.
 */
export class QueueRegistry {
  private readonly entries = new Map<string, QueueEntry>();
  private readonly ensuring = new Map<string, Promise<QueueRow>>();
  private readonly pendingOptions = new Map<string, QueueOptions>();
  /** How stale a cached pause flag may get before the tick refreshes it. */
  private readonly staleAfterMs: number;

  constructor(
    private readonly driver: Driver,
    private readonly clock: Clock,
    options: { tickIntervalSeconds?: number; headless?: boolean } = {},
  ) {
    this.staleAfterMs = secondsToMs(
      options.tickIntervalSeconds ?? DEFAULT_TICK_INTERVAL_SECONDS,
      'tickIntervalSeconds',
    );
    this.headless = options.headless ?? false;
  }

  private readonly headless: boolean;

  /**
   * Record a queue's declared options (no I/O). **Only `PortQueue.createQueue` calls this** — see the
   * class comment. Options replace any previous declaration for the same name. A no-op on a headless
   * client, which declares nothing.
   */
  declare(name: string, options: QueueOptions): void {
    if (this.headless) return;
    const existing = this.entries.get(name);
    if (existing) {
      existing.options = options;
      return;
    }
    this.pendingOptions.set(name, options);
  }

  getOptions(name: string): QueueOptions {
    return this.entries.get(name)?.options ?? this.pendingOptions.get(name) ?? {};
  }

  /**
   * Resolve (and cache) the queue row. Idempotent under concurrency.
   *
   * Creates the row when absent — except on a headless client, where it reads and throws
   * {@link QueueNotFoundError} if the queue was never declared by an application.
   */
  async ensure(name: string): Promise<QueueRow> {
    const cached = this.entries.get(name);
    if (cached) return cached.row;
    const inflight = this.ensuring.get(name);
    if (inflight) return inflight;
    const options = this.pendingOptions.get(name);
    const promise = this.resolveRow(name, options)
      .then((row) => {
        this.entries.set(name, {
          row,
          options: options ?? {},
          refreshedAt: this.clock.now(),
        });
        this.pendingOptions.delete(name);
        this.ensuring.delete(name);
        return row;
      })
      .catch((err: unknown) => {
        // Don't strand a rejected promise in the map — the next caller must be able to retry.
        this.ensuring.delete(name);
        throw err;
      });
    this.ensuring.set(name, promise);
    return promise;
  }

  private async resolveRow(name: string, options: QueueOptions | undefined): Promise<QueueRow> {
    if (this.headless) {
      const row = await this.driver.getQueueByName({ name });
      if (!row) throw new QueueNotFoundError(name);
      return row;
    }
    return this.driver.ensureQueue({
      name,
      ...(options ? { options } : {}),
      now: this.clock.now(),
    });
  }

  /**
   * The cached pause flags for a queue, with **no I/O**. Read on the hot path by every worker pump.
   * `null` when the queue has not been ensured in this process yet, which a worker never sees — it
   * awaits `ensure()` before its first pump.
   */
  pauseState(name: string): { processingPaused: boolean; acceptingPaused: boolean } | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    return {
      processingPaused: entry.row.processingPaused,
      acceptingPaused: entry.row.acceptingPaused,
    };
  }

  /** Overwrite the cached row from one a driver just returned (a pause/resume this process made). */
  update(row: QueueRow): void {
    const entry = this.entries.get(row.name);
    if (entry) {
      entry.row = row;
      entry.refreshedAt = this.clock.now();
    }
  }

  /** Re-read one queue's flags from the database. */
  async refresh(name: string): Promise<QueueRow | null> {
    const row = await this.driver.getQueueByName({ name });
    if (row) this.update(row);
    return row;
  }

  /**
   * Refresh every declared queue whose cached flags have gone stale. Driven by the maintenance tick,
   * so a pause made by another instance is observed within one tick interval — the same latency the
   * per-pump read gave, at one query per queue per tick instead of one per pump.
   */
  async refreshStale(): Promise<void> {
    const now = this.clock.now();
    const stale = [...this.entries.entries()]
      .filter(([, entry]) => now - entry.refreshedAt >= this.staleAfterMs)
      .map(([name]) => name);
    await Promise.all(stale.map((name) => this.refresh(name).catch(() => null)));
  }

  /**
   * Whether this queue was declared in *this* process (via createQueue/createWorker), whether or
   * not its row has been ensured yet. Used to block manual queue removal of an in-use queue: a
   * running process that still references the queue must not have it deleted from under it. Always
   * false on a headless client — an admin tool never owns a queue.
   */
  isRegistered(name: string): boolean {
    if (this.headless) return false;
    return this.entries.has(name) || this.pendingOptions.has(name) || this.ensuring.has(name);
  }
}
