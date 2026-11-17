import { LogLevel, PortQueue, PortQueueEvent } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';
import { QUEUE_NAME } from '../config.ts';
import { waitUntil } from '../stats.ts';
import type { Contender, JobData } from '../contender.ts';

/**
 * PortQueue from this repository's working tree (`@portqueue/core` resolves to the workspace
 * package), on its own PGLite driver with no `dataDir` — an in-memory database.
 */
export function createPortQueueContender(): Contender {
  const pq = new PortQueue({
    driver: new PgliteDriver(),
    logger: { level: LogLevel.ERROR },
  });
  let completed = 0;

  return {
    async start() {
      await pq.init();
      pq.on(PortQueueEvent.JOB_COMPLETED, () => {
        completed += 1;
      });
      pq.on(PortQueueEvent.ERROR, ({ error }) => {
        console.error('[portqueue]', error);
      });
    },

    async countJobs() {
      const { counts } = await pq.getQueuesStats();
      return Object.values(counts).reduce((sum, n) => sum + n, 0);
    },

    async add(data) {
      await pq.addJob({ queue: QUEUE_NAME, data });
    },

    async addMany(data) {
      await pq.addJobs<JobData>({ queue: QUEUE_NAME, jobs: data.map((d) => ({ data: d })) });
    },

    async consume(handler, concurrency) {
      // `createQueue` starts the worker asynchronously; wait until it is listening for wakeups, the
      // same way `boss.work()` resolves only once its worker is registered.
      const started = new Promise<void>((resolve) => {
        pq.once(PortQueueEvent.WORKER_STARTED, () => resolve(), { queue: QUEUE_NAME });
      });
      pq.createQueue<JobData>({
        name: QUEUE_NAME,
        handler: (job) => handler(job.data),
        limiter: { concurrency, batchSize: concurrency },
      });
      await started;
    },

    async waitForCompleted(count) {
      // JOB_COMPLETED fires only after the row is settled, so the counter is the database's view.
      await waitUntil(() => completed >= count);
    },

    async stop() {
      await pq.shutdown({ graceful: false });
    },
  };
}
