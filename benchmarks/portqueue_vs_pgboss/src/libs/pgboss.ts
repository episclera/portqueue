import { PGlite } from '@electric-sql/pglite';
import { fromPglite, PgBoss } from 'pg-boss';
import { QUEUE_NAME } from '../config.ts';
import { waitUntil } from '../stats.ts';
import type { Contender } from '../contender.ts';

/** pg-boss's floor for `pollingIntervalSeconds`. It is only the backstop here, since NOTIFY wakes workers. */
const PGBOSS_POLLING_INTERVAL_SECONDS = 0.5;

/**
 * pg-boss on PGLite exactly as its docs set it up: `backend: 'pglite'` with the official
 * `fromPglite` adapter over one in-memory PGLite instance — the same engine PortQueue's own PGLite
 * driver uses.
 *
 * Tuned for its best showing rather than left at defaults, mirroring what PortQueue does out of
 * the box:
 * - `useListenNotify` + the queue's `notify: true` — workers are woken the moment a job is created
 *   (PGLite supports LISTEN/NOTIFY in-process), like PortQueue's in-process wakeup, instead of
 *   waiting out a poll;
 * - `burstWhenBatchFull` — keep fetching with no delay while batches come back full, like
 *   PortQueue's claim loop, which claims again as soon as it has capacity.
 */
export function createPgBossContender(): Contender {
  // No dataDir: a new, empty, in-memory database for every run.
  const pg = new PGlite();
  const boss = new PgBoss({
    backend: 'pglite',
    db: fromPglite(pg),
    useListenNotify: true,
    supervise: false,
    schedule: false,
  });
  let handled = 0;

  const count = async (where: string): Promise<number> => {
    // `pgboss.job` is the partitioned parent table, so this covers every queue's partition.
    const { rows } = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pgboss.job ${where}`,
      where ? [QUEUE_NAME] : [],
    );
    return rows[0]?.n ?? 0;
  };

  return {
    async start() {
      boss.on('error', (error: unknown) => console.error('[pg-boss]', error));
      await boss.start();
      await boss.createQueue(QUEUE_NAME, { notify: true });
    },

    countJobs() {
      return count('');
    },

    async add(data) {
      await boss.send(QUEUE_NAME, data);
    },

    async addMany(data) {
      await boss.insert(
        QUEUE_NAME,
        data.map((d) => ({ data: d })),
      );
    },

    async consume(handler, concurrency) {
      // One worker fetching `concurrency` jobs per poll and running them concurrently is pg-boss's
      // equivalent of PortQueue's `{ concurrency, batchSize }`: the same number fetched per claim
      // and the same number in flight.
      await boss.work<{ i: number }>(
        QUEUE_NAME,
        {
          batchSize: concurrency,
          pollingIntervalSeconds: PGBOSS_POLLING_INTERVAL_SECONDS,
          burstWhenBatchFull: true,
        },
        async (jobs) => {
          await Promise.all(jobs.map((job) => handler(job.data)));
          handled += jobs.length;
        },
      );
    },

    async waitForCompleted(target) {
      // pg-boss settles a batch right after its handler resolves and emits nothing per job, so wait
      // for the handlers first (no database traffic), then for the rows to read `completed`.
      await waitUntil(() => handled >= target);
      await waitUntil(
        async () => (await count("WHERE name = $1 AND state = 'completed'")) >= target,
        { everyMs: 10 },
      );
    },

    async stop() {
      await boss.stop({ graceful: false });
      await pg.close();
    },
  };
}
