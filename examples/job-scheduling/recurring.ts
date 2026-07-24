/**
 * Recurring jobs — `schedule.startEvery` (fixed interval) and `schedule.cron`.
 *
 * Run with: `npm run example:schedule-recurring` (from the repo root) or `npm run recurring` here.
 * Runs until you press Ctrl+C.
 *
 * A recurring `addJob` creates/updates a recurring producer; `data` + the job options become the
 * template for every produced run. Backed by PGLite under the repo-root `tmp/` folder, so there's
 * no external database to install or start.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortQueue } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir =
  process.env.PORTQUEUE_DATA_DIR ?? resolve(here, '../..', 'tmp/portqueue-example-scheduling');

type QueueName = 'healthchecks' | 'reports';

async function main(): Promise<void> {
  const pq = new PortQueue<QueueName>({ driver: new PgliteDriver({ dataDir }) });
  await pq.init();

  const healthchecks = pq.createQueue<Record<string, never>>('healthchecks');
  pq.createWorker<Record<string, never>>({
    queue: 'healthchecks',
    handler: async () => {
      console.log(`💓 [${new Date().toISOString()}] healthcheck`);
    },
  });

  const reports = pq.createQueue<{ kind: string }>('reports');
  pq.createWorker<{ kind: string }>({
    queue: 'reports',
    handler: async (job) => {
      console.log(`📊 [${new Date().toISOString()}] building ${job.data.kind} report`);
    },
  });

  // Fixed interval: every 3 seconds. An `idempotencyKey` keeps exactly one schedule even if this
  // script is run repeatedly against the same (persisted) database.
  const healthcheckSchedule = await healthchecks.addJob({
    data: {},
    schedule: { startEvery: '3s' },
    idempotencyKey: 'healthcheck-every-3s',
  });

  // Cron: every minute (6-field form with seconds would be '0 * * * * *'; this 5-field runs
  // at the top of every minute, in UTC).
  const reportSchedule = await reports.addJob({
    data: { kind: 'sales' },
    schedule: { cron: '* * * * *' },
    idempotencyKey: 'sales-report-every-minute',
  });

  // A recurring add returns a `scheduleId`. Persist it somewhere durable (your own DB, config,
  // etc.) if you might ever want to stop new runs being spawned for this interval/cron later —
  // that's the id you pass to `queue.removeSchedule({ scheduleId })` to unschedule it. (Here we
  // just log them; you'd normally save them alongside whatever owns the recurrence.)
  console.log('Schedule ids (save these to unschedule later):', {
    healthcheck: healthcheckSchedule.scheduleId,
    salesReport: reportSchedule.scheduleId,
  });

  console.log('Scheduled: healthcheck every 3s, sales report every minute. Ctrl+C to stop.\n');

  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down…');
    await pq.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
