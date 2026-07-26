/**
 * Delayed (one-off) jobs — `schedule.startAfterSeconds`.
 *
 * Run with: `npm run example:schedule-delayed` (from the repo root) or `npm run delayed` here.
 *
 * Scheduling lives on `addJob` itself; there is no separate `schedule()` method. A one-off delay
 * is `startAfterSeconds` — a whole number of seconds from now, the only way the tool expresses a
 * delay. Backed by PGLite under the repo-root `tmp/` folder, so there's no external database to
 * install or start.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortQueue } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir =
  process.env.PORTQUEUE_DATA_DIR ?? resolve(here, '../..', 'tmp/portqueue-example-scheduling');

type QueueName = 'reminders';

async function main(): Promise<void> {
  const pq = new PortQueue<QueueName>({ driver: new PgliteDriver({ dataDir }) });
  await pq.init();

  const reminders = pq.createQueue<{ message: string }>('reminders');

  pq.createWorker<{ message: string }>({
    queue: 'reminders',
    handler: async (job) => {
      console.log(`⏰ [${new Date().toISOString()}] reminder: ${job.data.message}`);
    },
  });

  // Runs immediately.
  await reminders.addJob({ data: { message: 'this one runs now' } });

  // Runs ~3 seconds from now. Durations are always whole seconds — no unit strings to get wrong.
  await reminders.addJob({
    data: { message: 'this one runs in 3s' },
    schedule: { startAfterSeconds: 3 },
  });

  // There is no absolute-Date option: `startAfterSeconds` is the only way to delay a job, so for a
  // known wall-clock instant you subtract now and pass the difference in seconds.
  const at = new Date(Date.now() + 5_000);
  await reminders.addJob({
    data: { message: `this one runs at ${at.toISOString()}` },
    schedule: { startAfterSeconds: Math.round((at.getTime() - Date.now()) / 1000) },
  });

  console.log(`Enqueued 3 reminders (now, +3s, +5s). Waiting for them to run…\n`);

  // Give the delayed jobs time to fire, then shut down cleanly.
  await new Promise((r) => setTimeout(r, 7_000));
  await pq.shutdown();
  console.log('\nDone.');
  process.exit(0);
}

void main();
