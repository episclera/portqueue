/**
 * A debounced "there is work" signal that wakes claim loops.
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
    const subscribers = set;
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
      // Drop the queue's entry once its last subscriber goes, and only if it is still *this* set: a
      // resubscribe between the two would have installed a new one, and deleting that would strand
      // a live listener. An emptied set left in the map is small, but `signalAll` then walks it
      // forever in a process that declares and tears down queues.
      if (subscribers.size === 0 && this.subscribers.get(queue) === subscribers) {
        this.subscribers.delete(queue);
      }
    };
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

  /**
   * How many queues currently have a subscriber. `@internal` — it exists so a test can assert the
   * map does not grow with every queue a process declares and tears down.
   */
  get queueCount(): number {
    return this.subscribers.size;
  }
}
