import type { TransactionHandle, TxQueryResult } from './transaction-handle';

/** Build a {@link TransactionHandle} from a raw executor. */
function makeHandle(
  engine: string,
  execute: (sql: string, params: readonly unknown[]) => Promise<TxQueryResult>,
  onCommit?: (cb: () => void) => void,
): TransactionHandle {
  return { __portqueueTx: true, engine, execute, ...(onCommit ? { onCommit } : {}) };
}

function normalizeRows(result: unknown): TxQueryResult {
  if (Array.isArray(result))
    return { rows: result as Array<Record<string, unknown>>, rowCount: result.length };
  const r = result as {
    rows?: Array<Record<string, unknown>>;
    rowCount?: number;
    changes?: number;
  };
  const rows = r?.rows ?? [];
  return { rows, rowCount: r?.rowCount ?? r?.changes ?? rows.length };
}

// --- Raw clients ---

/** Wrap a `pg` PoolClient/Client mid-transaction. */
export function fromPg(client: {
  query(sql: string, params?: readonly unknown[]): Promise<unknown>;
}): TransactionHandle {
  return makeHandle('POSTGRES', async (sql, params) =>
    normalizeRows(await client.query(sql, params)),
  );
}

/** Wrap a `better-sqlite3` Database (synchronous). */
export function fromBetterSqlite3(db: {
  prepare(sql: string): {
    all(...p: unknown[]): unknown[];
    run(...p: unknown[]): { changes: number };
  };
}): TransactionHandle {
  return makeHandle('SQLITE', async (sql, params) => {
    const stmt = db.prepare(sql);
    if (/^\s*select/i.test(sql) || /returning/i.test(sql)) {
      const rows = stmt.all(...params) as Array<Record<string, unknown>>;
      return { rows, rowCount: rows.length };
    }
    const info = stmt.run(...params);
    return { rows: [], rowCount: info.changes };
  });
}

/** Wrap a `node:sqlite` DatabaseSync. */
export function fromNodeSqlite(db: {
  prepare(sql: string): {
    all(...p: unknown[]): unknown[];
    run(...p: unknown[]): { changes: number | bigint };
  };
}): TransactionHandle {
  return makeHandle('SQLITE', async (sql, params) => {
    const stmt = db.prepare(sql);
    if (/^\s*select/i.test(sql) || /returning/i.test(sql)) {
      const rows = stmt.all(...params) as Array<Record<string, unknown>>;
      return { rows, rowCount: rows.length };
    }
    const info = stmt.run(...params);
    return { rows: [], rowCount: Number(info.changes) };
  });
}

/** Wrap an `oracledb` connection mid-transaction. */
export function fromOracle(connection: {
  execute(sql: string, binds?: unknown[]): Promise<{ rows?: unknown[]; rowsAffected?: number }>;
}): TransactionHandle {
  return makeHandle('ORACLE', async (sql, params) => {
    const res = await connection.execute(sql, [...params]);
    const rows = (res.rows as Array<Record<string, unknown>>) ?? [];
    return { rows, rowCount: res.rowsAffected ?? rows.length };
  });
}

// --- Query builders ---

/** Wrap a Knex transaction. Uses `trx.raw`; commit-hook deferral relies on the safety poll. */
export function fromKnex(trx: {
  raw(sql: string, bindings?: readonly unknown[]): Promise<unknown>;
}): TransactionHandle {
  return makeHandle('POSTGRES', async (sql, params) => normalizeRows(await trx.raw(sql, params)));
}

/** Wrap a Kysely transaction via its underlying driver connection executor. */
export function fromKysely(executor: {
  executeQuery?: (sql: string, params: readonly unknown[]) => Promise<unknown>;
  raw?: (sql: string, params?: readonly unknown[]) => Promise<unknown>;
}): TransactionHandle {
  return makeHandle('POSTGRES', async (sql, params) => {
    if (executor.executeQuery) return normalizeRows(await executor.executeQuery(sql, params));
    if (executor.raw) return normalizeRows(await executor.raw(sql, params));
    throw new Error('fromKysely: provide an executor exposing executeQuery(sql, params).');
  });
}

/** Wrap a Drizzle transaction (uses its `.execute` escape hatch with a raw SQL string). */
export function fromDrizzle(
  tx: { execute(query: unknown): Promise<unknown> },
  sqlTag?: (s: string, p: readonly unknown[]) => unknown,
): TransactionHandle {
  return makeHandle('POSTGRES', async (sql, params) => {
    const query = sqlTag ? sqlTag(sql, params) : sql;
    return normalizeRows(await tx.execute(query));
  });
}

// --- ORMs ---

/** Wrap a Prisma interactive-transaction client (`prisma.$queryRawUnsafe` / `$executeRawUnsafe`). */
export function fromPrisma(txClient: {
  $queryRawUnsafe(sql: string, ...params: unknown[]): Promise<unknown>;
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
}): TransactionHandle {
  return makeHandle('POSTGRES', async (sql, params) => {
    if (/^\s*select/i.test(sql) || /returning/i.test(sql)) {
      const rows = (await txClient.$queryRawUnsafe(sql, ...params)) as Array<
        Record<string, unknown>
      >;
      return { rows, rowCount: rows.length };
    }
    const count = await txClient.$executeRawUnsafe(sql, ...params);
    return { rows: [], rowCount: count };
  });
}

/** Wrap a TypeORM EntityManager or QueryRunner. */
export function fromTypeorm(em: {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}): TransactionHandle {
  return makeHandle('POSTGRES', async (sql, params) =>
    normalizeRows(await em.query(sql, [...params])),
  );
}

/** Wrap a Sequelize transaction (paired with the Sequelize instance's `query`). */
export function fromSequelize(
  sequelize: {
    query(
      sql: string,
      options: { bind?: readonly unknown[]; transaction: unknown },
    ): Promise<unknown>;
  },
  transaction: unknown,
): TransactionHandle {
  return makeHandle('POSTGRES', async (sql, params) => {
    const res = (await sequelize.query(sql, { bind: params, transaction })) as unknown;
    // Sequelize returns [rows, metadata] for raw queries.
    if (Array.isArray(res)) return normalizeRows(res[0]);
    return normalizeRows(res);
  });
}

/** Wrap a MikroORM EntityManager. */
export function fromMikroOrm(em: {
  getConnection(): { execute(sql: string, params?: unknown[]): Promise<unknown> };
}): TransactionHandle {
  return makeHandle('POSTGRES', async (sql, params) =>
    normalizeRows(await em.getConnection().execute(sql, [...params])),
  );
}
