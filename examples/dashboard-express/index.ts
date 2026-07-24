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
  const pq = new PortQueue<QueueName>({
    driver: new PgliteDriver({ dataDir }),
  });
  await pq.init();

  // A worker + seed jobs so the dashboard shows live data.
  const emails = pq.createQueue<{ to: string; template: string }>('emails');
  pq.createWorker<{ to: string; template: string }>({
    queue: 'emails',
    limiter: { concurrency: 5 },
    handler: async (job) => {
      console.log(`📧 sending "${job.data.template}" to ${job.data.to}`);
    },
  });
  await emails.addJob({ data: { to: 'ada@example.com', template: 'welcome' } });
  await emails.addJob({
    data: { to: 'alan@example.com', template: 'digest' },
    schedule: { startAfter: '30s' },
  });
  await pq.createQueue<{ kind: string }>('reports').addJob({
    data: { kind: 'sales' },
    schedule: { startEvery: '15s' },
  });

  const app = express();

  // Your own application routes live next to the dashboard middleware.
  app.get('/', (_req, res) => {
    res.type('text/plain').send('App is running. Dashboard: /portqueue');
  });

  // Mount the dashboard. `dashboard.express()` is standard `(req, res, next)` middleware and
  // owns only its own base path, falling through to your routes otherwise.
  const dashboard = createDashboard({ portQueue: pq, title: 'PortQueue — Express example' });
  app.use(dashboard.express());

  const server = app.listen(PORT, HOST, () => {
    console.log(`\n🚀 App:       http://${HOST}:${PORT}/`);
    console.log(`🚀 Dashboard: http://${HOST}:${PORT}${dashboard.basePath}\n`);
  });

  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down…');
    server.close();
    await pq.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
