/**
 * Retries with exponential backoff — `retry` on `addJob`.
 *
 * Run with: `npm run example:retries` (from the repo root) or `npm start` here.
 *
 * A handler signals failure by throwing. When `retry.maxAttempts > 1`, PortQueue re-arms the job
 * after a delay computed from `retry.delay` and the `backoff` strategy. Backed by PGLite under the
 * repo-root `tmp/` folder, so there's no external database to install or start.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackoffStrategy, PortQueue } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir =
  process.env.PORTQUEUE_DATA_DIR ?? resolve(here, '../..', 'tmp/portqueue-example-retries');

type QueueName = 'charges';

async function main(): Promise<void> {
  const pq = new PortQueue<QueueName>({ driver: new PgliteDriver({ dataDir }) });
  await pq.init();

  const charges = pq.createQueue<{ id: string }>('charges');

  let attempts = 0;
  pq.createWorker<{ id: string }>({
    queue: 'charges',
    handler: async (job) => {
      attempts += 1;
      console.log(`▶️  attempt ${job.retryAttempt + 1}/${job.retryMaxAttempts} for ${job.data.id}`);
      // Fail the first two attempts, then succeed — exercises the backoff schedule.
      if (attempts < 3) throw new Error('payment gateway timeout');
      console.log(`✅ charge ${job.data.id} settled on attempt ${attempts}`);
    },
  });

  await charges.addJob({
    data: { id: 'ch_123' },
    retry: {
      maxAttempts: 3, // total attempts including the first
      delaySeconds: 0.5, // base delay before a retry — like every duration, in seconds
      backoff: {
        strategy: BackoffStrategy.EXPONENTIAL, // FIXED or EXPONENTIAL
        factor: 2, // each retry waits factor× the previous (500ms → 1s → 2s …)
        maxDelaySeconds: 10, // cap on the computed delay, in seconds
        jitter: true, // spread retries across instances
      },
    },
  });

  console.log('Enqueued a job that fails twice, then succeeds. Watching the retries…\n');
  await new Promise((r) => setTimeout(r, 6_000));
  await pq.shutdown();
  console.log('\nDone.');
  process.exit(0);
}

void main();
