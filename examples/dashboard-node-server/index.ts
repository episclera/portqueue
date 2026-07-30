/**
 * Serve the PortQueue dashboard from a plain `node:http` server.
 *
 * Run with: `npm run example:dashboard-node` (from the repo root) or `npm start` here.
 * Then open http://127.0.0.1:4321/portqueue
 *
 * Everything is backed by PGLite in a file-backed data directory under the repo-root `tmp/`
 * folder, so there is no external database to install or start.
 */
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortQueue } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';
import { createDashboard } from '@portqueue/dashboard';

// Persist the DB under <repo-root>/tmp (gitignored) — the same convention as scripts/cli.
const here = dirname(fileURLToPath(import.meta.url));
const dataDir =
  process.env.PORTQUEUE_DATA_DIR ?? resolve(here, '../..', 'tmp/portqueue-example-dashboard-node');

const HOST = '127.0.0.1';
const PORT = 4321;

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
    instance: { instanceKey: process.env.PORTQUEUE_INSTANCE_KEY ?? 'node-example-1' },
  });
  await pq.init();

  // A worker so the dashboard has completing jobs to show.
  pq.createQueue<{ to: string; template: string }>({ name: 'emails' });
  pq.createWorker<{ to: string; template: string }>({
    queue: 'emails',
    limiter: { concurrency: 5 },
    handler: async (job) => {
      console.log(`📧 sending "${job.data.template}" to ${job.data.to}`);
    },
  });

  // Seed some jobs so the dashboard isn't empty: a few immediate, one delayed, one recurring.
  // One insert for the pair, rather than a round trip each.
  await pq.addJobs({
    queue: 'emails',
    jobs: [
      { data: { to: 'ada@example.com', template: 'welcome' } },
      { data: { to: 'grace@example.com', template: 'welcome' } },
    ],
  });
  await pq.addJob({
    queue: 'emails',
    data: { to: 'alan@example.com', template: 'digest' },
    schedule: { startAfterSeconds: 30 }, // a delay, in seconds
  });

  pq.createQueue<{ kind: string }>({ name: 'reports' });
  // Every queue with jobs needs a worker, or its jobs just sit there as PENDING — including the
  // runs a recurring schedule keeps producing.
  pq.createWorker<{ kind: string }>({
    queue: 'reports',
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

  // Mount the dashboard and serve it from a bare node:http server. It takes the **driver**, not
  // this client: the dashboard opens its own headless connection on the first request, which is what
  // lets it run in a separate process from the workers in a real deployment.
  const dashboard = createDashboard({ driver });
  const handler = dashboard.node();

  const server = createServer((req, res) => {
    if (handler(req, res)) return; // the dashboard served it
    res.statusCode = 404;
    res.end('Not found — try ' + dashboard.basePath);
  });

  await new Promise<void>((r) => server.listen(PORT, HOST, r));
  console.log(`\n🚀 Dashboard: http://${HOST}:${PORT}${dashboard.basePath}\n`);

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
