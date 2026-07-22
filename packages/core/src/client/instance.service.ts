import type { Runtime } from './runtime.js';
import type { InstanceRow } from '../jobs/job-record.js';

/**
 * Multi-instance liveness + per-instance pause. Active only when the
 * PortQueue was given an `instanceKey`. Registers this process's `instance` row, then
 * heartbeats on a timer: each beat bumps `last_seen_at`, and refreshes two cached values the
 * worker's claim loop reads on the hot path — this instance's `processingPaused` flag and the
 * set of currently-alive instance keys (used for liveness-aware affinity). The dashboard can
 * pause an instance by flipping its row; the next heartbeat picks it up.
 */
export class InstanceService {
  private timer: NodeJS.Timeout | null = null;
  private _processingPaused = false;
  private _aliveKeys: string[];
  private readonly staleAfterMs: number;

  constructor(
    private readonly runtime: Runtime,
    readonly instanceKey: string,
    private readonly intervalMs: number,
  ) {
    // An instance is considered dead after missing several heartbeats.
    this.staleAfterMs = intervalMs * 3;
    this._aliveKeys = [instanceKey];
  }

  /** This instance's cached pause flag (refreshed each heartbeat). */
  get processingPaused(): boolean {
    return this._processingPaused;
  }

  /** Keys of instances whose heartbeat is fresh (includes self). */
  get aliveKeys(): readonly string[] {
    return this._aliveKeys;
  }

  /** Register the row and begin heartbeating. */
  async start(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => void this.beat(), this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One heartbeat: bump last_seen_at, then refresh cached pause + alive set. Never throws. */
  async beat(): Promise<void> {
    try {
      const now = this.runtime.clock.now();
      await this.runtime.driver.upsertInstance({ instanceKey: this.instanceKey, now });
      const instances = await this.runtime.driver.listInstances();
      const self = instances.find((i) => i.instanceKey === this.instanceKey);
      this._processingPaused = self?.processingPaused ?? false;
      this._aliveKeys = this.computeAlive(instances, now);
    } catch (err) {
      this.runtime.logger.debug('Instance heartbeat failed; keeping cached liveness.', { err });
    }
  }

  private computeAlive(instances: InstanceRow[], now: number): string[] {
    const cutoff = now - this.staleAfterMs;
    const alive = instances.filter((i) => i.lastSeenAt >= cutoff).map((i) => i.instanceKey);
    if (!alive.includes(this.instanceKey)) alive.push(this.instanceKey);
    return alive;
  }
}
