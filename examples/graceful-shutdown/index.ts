/**
 * Graceful shutdown — `pq.shutdown({ graceful, timeoutSeconds })`.
 *
 * Run with: `npm run example:graceful` (from the repo root) or `npm start` here.
 *
 * A graceful shutdown stops claiming new jobs and waits up to `timeoutSeconds` for in-flight handlers
 * to finish. Handlers should honour `job.signal` (an `AbortSignal`) so they can bail out promptly
 * if the timeout is hit. Backed by PGLite under the repo-root `tmp/` folder.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortQueue } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir =
  process.env.PORTQUEUE_DATA_DIR ?? resolve(here, '../..', 'tmp/portqueue-example-graceful');

type QueueName = 'reports';

/** A cancellable sleep that rejects if the job's AbortSignal fires. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      rej(new Error('aborted by graceful shutdown'));
    });
  });
}

async function main(): Promise<void> {
  const pq = new PortQueue<QueueName>({ driver: new PgliteDriver({ dataDir }) });
  await pq.init();

  const reports = pq.createQueue<{ id: string }>('reports');

  pq.createWorker<{ id: string }>({
    queue: 'reports',
    handler: async (job) => {
      console.log(`▶️  building report ${job.data.id} (honouring job.signal)…`);
      try {
        await sleep(2_000, job.signal); // long unit of work
        console.log(`✅ report ${job.data.id} finished`);
      } catch {
        console.log(`🛑 report ${job.data.id} aborted mid-flight`);
        throw new Error('interrupted');
      }
    },
  });

  await reports.addJob({ data: { id: 'r-1' } });

  // Let the handler start, then shut down gracefully with a generous window so it can complete.
  await new Promise((r) => setTimeout(r, 500));
  console.log('\nCalling pq.shutdown({ graceful: true, timeoutSeconds: 30 })…');
  await pq.shutdown({ graceful: true, timeoutSeconds: 30 });
  console.log('Shutdown complete — no jobs were left half-done.');
  process.exit(0);
}

void main();
