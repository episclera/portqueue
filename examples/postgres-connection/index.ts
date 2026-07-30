/**
 * A real Postgres connection — `PostgresDriver` + a `DATABASE_URL`.
 *
 * Run with: `npm run example:postgres` (from the repo root) or `npm start` here.
 *
 * Unlike the PGLite examples, this one talks to a **real Postgres server**, so it needs:
 *   1. the `pg` peer dependency installed (already declared here), and
 *   2. a reachable database — set `DATABASE_URL`, e.g.
 *      `DATABASE_URL=postgres://user:pass@localhost:5432/app npm run example:postgres`.
 *
 * The database must already exist; PortQueue creates only its own tables (migrations run on init).
 */
import { MigrationMode, PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://portqueue:portqueue@localhost:5432/portqueue';

type QueueName = 'welcome';

async function main(): Promise<void> {
  const pq = new PortQueue<QueueName>({
    driver: new PostgresDriver({ connectionString }),
    migration: MigrationMode.AUTO, // create/upgrade PortQueue's tables on init
  });
  await pq.init();
  console.log(`Connected to Postgres and migrated schema (${connectionString}).`);

  // One call declares the queue and consumes it: the `handler` is what makes this process a
  // consumer. Omit it and the declaration is producer-only.
  const done = new Promise<void>((resolve) => {
    pq.createQueue<{ user: string }>({
      name: 'welcome',
      handler: async (job) => {
        console.log(`👋 welcoming ${job.data.user}`);
        resolve();
      },
    });
  });

  const res = await pq.addJob({ queue: 'welcome', data: { user: 'ada' } });
  console.log(`Enqueued job ${res.jobId}. Waiting for the handler…`);

  await done;
  await pq.shutdown();
  console.log('Done.');
  process.exit(0);
}

void main();
