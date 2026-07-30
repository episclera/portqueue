import type { Worker } from '../consumer/worker';
import type { Queue } from '../producer/queue';

/** Tracks live Queue/Worker handles for graceful shutdown & stats. */
export class ClientRegistryService {
  private readonly workers: Worker[] = [];
  private readonly queues = new Map<string, Queue<unknown>>();

  addWorker(worker: Worker): void {
    this.workers.push(worker);
  }

  addQueue(name: string, queue: Queue<unknown>): void {
    this.queues.set(name, queue);
  }

  getQueue(name: string): Queue<unknown> | undefined {
    return this.queues.get(name);
  }

  allWorkers(): readonly Worker[] {
    return this.workers;
  }

  /** Try to cooperatively cancel an active job across all workers on this instance. */
  cancelRunning(jobId: string): boolean {
    for (const worker of this.workers) {
      if (worker.cancelRunning(jobId)) return true;
    }
    return false;
  }

  /**
   * Whether a job is currently running *in this process*. The read-only half of
   * {@link cancelRunning}, which both tests and acts and so can't be used as a probe.
   */
  isRunning(jobId: string): boolean {
    return this.workers.some((worker) => worker.executor.active.has(jobId));
  }
}
