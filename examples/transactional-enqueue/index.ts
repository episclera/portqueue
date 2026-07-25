/**
 * Transactional enqueue — enqueue a job atomically with your own DB write.
 *
 * Run with: `npm run example:transactional` (from the repo root) or `npm start` here.
 *
 * The pattern: open a transaction on your own `pg` client → do your business write → call
 * `addJob({ tx })` on the SAME transaction (wrap the client with `fromPg`) → commit. If anything
 * fails before commit, BOTH the business row and the job insert roll back together — you never end
 * up with a job for an order that was never saved (or an order with no follow-up job).
 *
 * Because the job is inserted inside your transaction, workers only see it AFTER you commit. On
 * Postgres the driver issues a NOTIFY at commit so listeners wake instantly; on engines without
 * LISTEN/NOTIFY, workers pick it up on their next poll.
 *
 * Needs the `pg` peer dependency and a reachable `DATABASE_URL` (the database must already exist).
 */
import pg from 'pg';
import { MigrationMode, PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';
import { fromPg } from '@portqueue/core/tx';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://portqueue:portqueue@localhost:5432/portqueue';

type QueueName = 'order-confirmations';

async function main(): Promise<void> {
  // One pool shared by our business writes and the PortQueue driver.
  const pool = new pg.Pool({ connectionString });
  await pool.query(
    'CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, total_cents INTEGER NOT NULL)',
  );

  const pq = new PortQueue<QueueName>({
    driver: new PostgresDriver({ pool }),
    migration: MigrationMode.AUTO,
  });
  await pq.init();

  const confirmations = pq.createQueue<{ orderId: string }>('order-confirmations');

  const done = new Promise<void>((resolve) => {
    pq.createWorker<{ orderId: string }>({
      queue: 'order-confirmations',
      handler: async (job) => {
        console.log(`✉️  sending confirmation for order ${job.data.orderId}`);
        resolve();
      },
    });
  });

  // --- The transactional enqueue ---
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 1. business write
    await client.query('INSERT INTO orders (id, total_cents) VALUES ($1, $2)', ['ord_1', 4200]);
    // 2. enqueue the follow-up job on the SAME transaction
    await confirmations.addJob({ data: { orderId: 'ord_1' }, tx: fromPg(client) });
    // 3. commit — order + job become durable together
    await client.query('COMMIT');
    console.log('Committed: order ord_1 and its confirmation job are now both durable.');
  } catch (err) {
    await client.query('ROLLBACK'); // order + job both vanish
    throw err;
  } finally {
    client.release();
  }

  await done;
  await pq.shutdown();
  await pool.end();
  console.log('Done.');
  process.exit(0);
}

void main();
