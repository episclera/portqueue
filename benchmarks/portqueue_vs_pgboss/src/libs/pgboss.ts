import { PGlite } from '@electric-sql/pglite';
import PgBoss from 'pg-boss';
import { QUEUE_NAME } from '../config.ts';
import { waitUntil } from '../stats.ts';
import type { Contender } from '../contender.ts';

/** pg-boss's floor for `pollingIntervalSeconds`; it has no in-process wakeup, so this is its pickup cadence. */
const PGBOSS_POLLING_INTERVAL_SECONDS = 0.5;

/**
 * pg-boss does not ship a PGLite driver, but it accepts any object with
 * `executeSql(text, values)` as its database. This adapter maps that onto one in-memory PGLite
 * instance — the same engine PortQueue's own PGLite driver uses.
 *
 * PGLite's `query()` uses the extended protocol, which allows one statement per call, while pg-boss
 * sends some multi-statement scripts (its migrations and `BEGIN; … COMMIT;` lock wrappers). Those go
 * through `exec()`, which runs a script but takes no parameters — so the rare multi-statement script
 * that *also* carries parameters has them inlined as escaped literals first.
 */
function pgliteDb(pg: PGlite): {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
} {
  return {
    async executeSql(text, values = []) {
      if (!isMultiStatement(text)) {
        const result = await pg.query(text, values);
        return { rows: result.rows };
      }
      const results = await pg.exec(values.length ? inlineParams(text, values) : text);
      return { rows: results.at(-1)?.rows ?? [] };
    },
  };
}

/** A `;` followed by more SQL. Only ever asked of pg-boss's own statements, never user input. */
function isMultiStatement(sql: string): boolean {
  return /;\s*\S/.test(sql.trim());
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `'${text.replaceAll("'", "''")}'`;
}

function inlineParams(sql: string, values: unknown[]): string {
  return sql.replace(/\$(\d+)\b/g, (_, n: string) => literal(values[Number(n) - 1]));
}

export function createPgBossContender(): Contender {
  // No dataDir: a new, empty, in-memory database for every run.
  const pg = new PGlite();
  const boss = new PgBoss({ db: pgliteDb(pg), supervise: false, schedule: false });
  let handled = 0;

  const completedRows = async (): Promise<number> => {
    const { rows } = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND state = 'completed'",
      [QUEUE_NAME],
    );
    return rows[0]?.n ?? 0;
  };

  return {
    async start() {
      boss.on('error', (error) => console.error('[pg-boss]', error));
      await boss.start();
      await boss.createQueue(QUEUE_NAME);
    },

    async countJobs() {
      const { rows } = await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM pgboss.job');
      return rows[0]?.n ?? 0;
    },

    async add(data) {
      await boss.send(QUEUE_NAME, data);
    },

    async addMany(data) {
      await boss.insert(data.map((d) => ({ name: QUEUE_NAME, data: d })));
    },

    async consume(handler, concurrency) {
      // One worker fetching `concurrency` jobs per poll and running them concurrently is pg-boss's
      // equivalent of PortQueue's `{ concurrency, batchSize }`: the same number fetched per claim
      // and the same number in flight.
      await boss.work<{ i: number }>(
        QUEUE_NAME,
        { batchSize: concurrency, pollingIntervalSeconds: PGBOSS_POLLING_INTERVAL_SECONDS },
        async (jobs) => {
          await Promise.all(jobs.map((job) => handler(job.data)));
          handled += jobs.length;
        },
      );
    },

    async waitForCompleted(count) {
      // pg-boss settles a batch right after its handler resolves and emits nothing per job, so wait
      // for the handlers first (no database traffic), then for the rows to read `completed`.
      await waitUntil(() => handled >= count);
      await waitUntil(async () => (await completedRows()) >= count, { everyMs: 10 });
    },

    async stop() {
      await boss.stop({ graceful: false, wait: true });
      await pg.close();
    },
  };
}
