import type { Worker } from '../consumer/worker.js';
import type { Queue } from '../producer/queue.js';

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

  totalInFlight(): number {
    return this.workers.reduce((sum, w) => sum + w.inFlight, 0);
  }

  /** Try to cooperatively cancel an active job across all workers on this instance. */
  cancelRunning(jobId: string): boolean {
    for (const worker of this.workers) {
      if (worker.cancelRunning(jobId)) return true;
    }
    return false;
  }
}
