import type { Runtime } from './runtime';

/**
 * Multi-instance liveness + per-instance pause. Active only when the
 * PortQueue was given an `instanceKey`. Registers this process's `instance` row, then
 * heartbeats on a timer: each beat bumps `last_seen_at` and refreshes this instance's cached
 * `processingPaused` flag, which the worker's claim loop reads on the hot path. The dashboard can
 * pause an instance by flipping its row; the next heartbeat picks it up.
 */
export class InstanceService {
  private timer: NodeJS.Timeout | null = null;
  private _processingPaused = false;

  constructor(
    private readonly runtime: Runtime,
    readonly instanceKey: string,
    private readonly intervalMs: number,
  ) {}

  /** This instance's cached pause flag (refreshed each heartbeat). */
  get processingPaused(): boolean {
    return this._processingPaused;
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

  /** One heartbeat: bump last_seen_at, then refresh the cached pause flag. Never throws. */
  async beat(): Promise<void> {
    try {
      const now = this.runtime.clock.now();
      await this.runtime.driver.upsertInstance({ instanceKey: this.instanceKey, now });
      const self = await this.runtime.driver.getInstance({ instanceKey: this.instanceKey });
      this._processingPaused = self?.processingPaused ?? false;
    } catch (err) {
      this.runtime.logger.debug('Instance heartbeat failed; keeping cached pause state.', { err });
    }
  }
}
