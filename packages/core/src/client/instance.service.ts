import type { Runtime } from './runtime';
import type { SystemMetrics } from '../monitoring/system-monitor.service';

/**
 * Multi-instance liveness, health reporting + per-instance pause. Active only when the
 * PortQueue was given an `instanceKey`. Registers this process's `instance` row, then
 * heartbeats on a timer: each beat bumps `last_seen_at`, records the latest CPU / memory sample for
 * **this Node process** alongside it, and refreshes this instance's cached
 * `processingPaused` flag, which the worker's claim loop reads on the hot path. The dashboard can
 * pause an instance by flipping its row; the next heartbeat picks it up.
 *
 * The metrics ride along with the heartbeat rather than on their own timer: they are only useful as
 * "how was this instance doing when we last heard from it", which is exactly what a beat means.
 */
export class InstanceService {
  private timer: NodeJS.Timeout | null = null;
  private _processingPaused = false;

  constructor(
    private readonly runtime: Runtime,
    readonly instanceKey: string,
    private readonly intervalSeconds: number,
    /** This process's latest health sample; null before the first one lands. */
    private readonly readMetrics: () => SystemMetrics | null,
  ) {}

  /** This instance's cached pause flag (refreshed each heartbeat). */
  get processingPaused(): boolean {
    return this._processingPaused;
  }

  /** Register the row and begin heartbeating. */
  async start(): Promise<void> {
    await this.beat();
    this.timer = setInterval(
      () => this.runtime.background.run(() => this.beat()),
      this.intervalSeconds * 1000,
    );
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One heartbeat: bump last_seen_at + metrics, then refresh the cached pause flag. Never throws. */
  async beat(): Promise<void> {
    try {
      const now = this.runtime.clock.now();
      const metrics = this.readMetrics();
      await this.runtime.driver.upsertInstance({
        instanceKey: this.instanceKey,
        now,
        ...(metrics
          ? {
              metrics: {
                cpuPercent: metrics.cpuPercent,
                memoryPercent: metrics.memoryPercent,
              },
            }
          : {}),
      });
      const self = await this.runtime.driver.getInstance({ instanceKey: this.instanceKey });
      this._processingPaused = self?.processingPaused ?? false;
    } catch (err) {
      this.runtime.logger.debug('Instance heartbeat failed; keeping cached pause state.', { err });
    }
  }
}
