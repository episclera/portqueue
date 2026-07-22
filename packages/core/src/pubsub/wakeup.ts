/**
 * A debounced "there is work" signal that wakes claim loops (build_plan/02.2).
 * Per-queue subscribers are notified when a job is added or a NOTIFY/poll fires.
 */
export class Wakeup {
  private readonly subscribers = new Map<string, Set<() => void>>();

  subscribe(queue: string, callback: () => void): () => void {
    let set = this.subscribers.get(queue);
    if (!set) {
      set = new Set();
      this.subscribers.set(queue, set);
    }
    set.add(callback);
    return () => set!.delete(callback);
  }

  /** Wake all loops for one queue. */
  signal(queue: string): void {
    const set = this.subscribers.get(queue);
    if (set) for (const cb of set) cb();
  }

  /** Wake every loop (e.g. on system-pressure-normal). */
  signalAll(): void {
    for (const set of this.subscribers.values()) {
      for (const cb of set) cb();
    }
  }
}
