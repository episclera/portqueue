/**
 * Idempotency & singleton dedup — `idempotencyKey` and `singletonKey`.
 *
 * Run with: `npm run example:idempotency` (from the repo root) or `npm start` here.
 *
 * - `idempotencyKey`: first-writer-wins. A later add with the same key on the same queue returns
 *   the existing job instead of creating a new one (`result.deduplicated === true`).
 * - `singletonKey`: at most one *active-ish* (PENDING/ACTIVE/RETRY) job per key at a time.
 *
 * Backed by PGLite under the repo-root `tmp/` folder — nothing external to install or start.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortQueue } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir =
  process.env.PORTQUEUE_DATA_DIR ?? resolve(here, '../..', 'tmp/portqueue-example-idempotency');

type QueueName = 'emails';

async function main(): Promise<void> {
  const pq = new PortQueue<QueueName>({ driver: new PgliteDriver({ dataDir }) });
  await pq.init();

  const emails = pq.createQueue<{ to: string }>('emails');

  // Idempotency: enqueue the "same" welcome email twice with one key.
  const first = await emails.addJob({
    data: { to: 'ada@example.com' },
    idempotencyKey: 'welcome:ada@example.com',
  });
  const second = await emails.addJob({
    data: { to: 'ada@example.com' },
    idempotencyKey: 'welcome:ada@example.com',
  });

  console.log(`first add  → jobId=${first.jobId} deduplicated=${first.deduplicated}`);
  console.log(
    `second add → jobId=${second.jobId} deduplicated=${second.deduplicated}` +
      ` (reason: ${second.deduplicationReason ?? 'n/a'})`,
  );
  console.log(`same job?  → ${first.jobId === second.jobId}\n`);

  // Singleton: at most one in-flight job per key. The second add dedups while the first is pending.
  const a = await emails.addJob({ data: { to: 'grace@example.com' }, singletonKey: 'digest:grace' });
  const b = await emails.addJob({ data: { to: 'grace@example.com' }, singletonKey: 'digest:grace' });
  console.log(`singleton first  → jobId=${a.jobId} deduplicated=${a.deduplicated}`);
  console.log(`singleton second → jobId=${b.jobId} deduplicated=${b.deduplicated}`);

  await pq.shutdown();
  console.log('\nDone.');
  process.exit(0);
}

void main();
