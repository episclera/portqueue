import { secondsToMs } from '../util/seconds';

/**
 * Tracks the work this client starts without awaiting it — the maintenance tick, a worker's
 * claim pump, an instance heartbeat, a NOTIFY — so shutdown can wait for it to settle before
 * the driver disconnects. Without this, `disconnect()` can land while one of those queries is
 * still in flight: an engine that runs inside this process (PGLite tears down its WASM heap)
 * faults, and a pooled engine logs a query against a closed connection.
 *
 * Failures are not this class's business: every registered task already reports its own errors,
 * so a rejection is swallowed here rather than surfacing as an unhandled rejection (which is
 * what `void task()` did).
 */
export class BackgroundWork {
  private readonly pending = new Set<Promise<void>>();

  /** Start `task` now, without waiting for it, and remember it until it settles. */
  run(task: () => Promise<unknown>): void {
    const tracked = task().then(
      () => undefined,
      () => undefined,
    );
    this.pending.add(tracked);
    void tracked.then(() => this.pending.delete(tracked));
  }

  /**
   * Wait for everything in flight — and anything those tasks start in turn — to settle.
   * Resolves `true` when the set emptied, `false` when `timeoutSeconds` elapsed first, so the
   * caller can carry on with a shutdown it must not abandon.
   */
  async drain(timeoutSeconds: number): Promise<boolean> {
    const expired = expiresIn(secondsToMs(timeoutSeconds, 'shutdown timeoutSeconds'));
    while (this.pending.size > 0) {
      const settled = await Promise.race([
        Promise.all([...this.pending]).then(() => true),
        expired,
      ]);
      if (!settled) return false;
    }
    return true;
  }
}

/** A promise that resolves `false` once `ms` has passed, on a timer that never holds the loop. */
function expiresIn(ms: number): Promise<false> {
  return new Promise<false>((resolve) => {
    const timer = setTimeout(() => resolve(false), Math.max(ms, 0));
    timer.unref?.();
  });
}
