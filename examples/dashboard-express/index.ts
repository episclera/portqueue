/**
 * Mount the PortQueue dashboard as Express middleware, alongside your own routes.
 *
 * Run with: `npm run example:dashboard-express` (from the repo root) or `npm start` here.
 * Then open http://127.0.0.1:4322/portqueue
 *
 * Backed by PGLite in a file-backed data directory under the repo-root `tmp/` folder, so there
 * is no external database to install or start.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { PortQueue } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';
import { createDashboard } from '@portqueue/dashboard';

// Persist the DB under <repo-root>/tmp (gitignored) — the same convention as scripts/cli.
const here = dirname(fileURLToPath(import.meta.url));
const dataDir =
  process.env.PORTQUEUE_DATA_DIR ??
  resolve(here, '../..', 'tmp/portqueue-example-dashboard-express');

const HOST = '127.0.0.1';
const PORT = 4322;

type QueueName = 'emails' | 'reports';

async function main(): Promise<void> {
  // One driver, shared by the app's client and the dashboard's own. The dashboard builds its own
  // headless client from it (see `createDashboard` below) rather than riding on this one.
  const driver = new PgliteDriver({ dataDir });
  const pq = new PortQueue<QueueName>({
    driver,
    // Naming this process registers it as an instance, so the dashboard's Instances page has a
    // row to show — with its liveness, its own job counts, and per-instance pause/resume. Run a
    // second copy with PORTQUEUE_INSTANCE_KEY set to a different name to see two servers.
    instance: { instanceKey: process.env.PORTQUEUE_INSTANCE_KEY ?? 'express-example-1' },
  });
  await pq.init();

  // A handler + seed jobs so the dashboard shows live data.
  pq.createQueue<{ to: string; template: string }>({
    name: 'emails',
    limiter: { concurrency: 5 },
    handler: async (job) => {
      console.log(`📧 sending "${job.data.template}" to ${job.data.to}`);
    },
  });
  await pq.addJob({ queue: 'emails', data: { to: 'ada@example.com', template: 'welcome' } });
  await pq.addJob({
    queue: 'emails',
    data: { to: 'alan@example.com', template: 'digest' },
    schedule: { startAfterSeconds: 30 }, // a delay, in seconds
  });

  // Every queue with jobs needs a handler, or its jobs just sit there as PENDING — including the
  // runs a recurring schedule keeps producing.
  pq.createQueue<{ kind: string }>({
    name: 'reports',
    handler: async (job) => {
      console.log(`📊 building the ${job.data.kind} report`);
    },
  });
  await pq.addJob({
    queue: 'reports',
    data: { kind: 'sales' },
    // Deliberately unhurried: a schedule that fires every few seconds fills the dashboard with
    // near-identical rows faster than you can read one. Five minutes is enough to watch a run
    // appear, and `startAfterSeconds` above gives you something arriving sooner.
    schedule: { startEverySeconds: 300 }, // every 5 minutes, expressed in seconds
    // Keeps a single schedule across restarts of this example (the data dir is persisted).
    idempotencyKey: 'sales-report-every-5m',
  });

  const app = express();

  // Your own application routes live next to the dashboard middleware.
  app.get('/', (_req, res) => {
    res.type('text/plain').send('App is running. Dashboard: /portqueue');
  });

  // Mount the dashboard. `dashboard.express()` is standard `(req, res, next)` middleware and
  // owns only its own base path, falling through to your routes otherwise.
  // It takes the **driver**, not this client: the dashboard opens its own headless connection on the
  // first request, which is what lets it run in a separate process from the workers in production.
  const dashboard = createDashboard({ driver });
  app.use(dashboard.express());

  const server = app.listen(PORT, HOST, () => {
    console.log(`\n🚀 App:       http://${HOST}:${PORT}/`);
    console.log(`🚀 Dashboard: http://${HOST}:${PORT}${dashboard.basePath}\n`);
  });

  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down…');
    server.close();
    await dashboard.close();
    await pq.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
