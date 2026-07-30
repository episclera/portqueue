import type { Worker } from '../consumer/worker';
import type { Queue } from '../producer/queue';

/**
 * Tracks this process's queue declarations and their consumers, for graceful shutdown, stats and
 * cooperative cancellation.
 *
 * A queue has **at most one** consumer per process, so the consumers are keyed by queue name.
 * `PortQueue.createQueue` builds one when a declaration carries a `handler`, and {@link hasWorker} is
 * how it refuses a second one before it gets here — replacing a live consumer would strand its claim
 * loop outside {@link allWorkers}, where nothing would ever drain it.
 */
export class ClientRegistryService {
  private readonly workers = new Map<string, Worker>();
  private readonly queues = new Map<string, Queue<unknown>>();

  addWorker(queueName: string, worker: Worker): void {
    this.workers.set(queueName, worker);
  }

  hasWorker(queueName: string): boolean {
    return this.workers.has(queueName);
  }

  addQueue(name: string, queue: Queue<unknown>): void {
    this.queues.set(name, queue);
  }

  getQueue(name: string): Queue<unknown> | undefined {
    return this.queues.get(name);
  }

  allWorkers(): IterableIterator<Worker> {
    return this.workers.values();
  }

  /** Try to cooperatively cancel an active job across every queue consumed on this instance. */
  cancelRunning(jobId: string): boolean {
    for (const worker of this.workers.values()) {
      if (worker.cancelRunning(jobId)) return true;
    }
    return false;
  }

  /**
   * Whether a job is currently running *in this process*. The read-only half of
   * {@link cancelRunning}, which both tests and acts and so can't be used as a probe.
   */
  isRunning(jobId: string): boolean {
    for (const worker of this.workers.values()) {
      if (worker.executor.active.has(jobId)) return true;
    }
    return false;
  }
}
