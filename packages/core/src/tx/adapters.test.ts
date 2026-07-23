import {
  fromPg,
  fromBetterSqlite3,
  fromNodeSqlite,
  fromOracle,
  fromKnex,
  isTransactionHandle,
} from './index';

describe('transaction adapters', () => {
  it('fromPg forwards to client.query and normalizes rows/rowCount', async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const handle = fromPg({
      query: async (sql, params = []) => {
        calls.push({ sql, params });
        return { rows: [{ id: '1' }], rowCount: 1 };
      },
    });
    expect(isTransactionHandle(handle)).toBe(true);
    expect(handle.engine).toBe('POSTGRES');
    const res = await handle.execute('INSERT ... RETURNING id', ['a']);
    expect(res).toEqual({ rows: [{ id: '1' }], rowCount: 1 });
    expect(calls[0]!.params).toEqual(['a']);
  });

  it('fromBetterSqlite3 uses .all for RETURNING and .run otherwise', async () => {
    const db = {
      prepare: (_sql: string) => ({
        all: (..._p: unknown[]) => [{ id: 'x' }],
        run: (..._p: unknown[]) => ({ changes: 3 }),
      }),
    };
    const handle = fromBetterSqlite3(db);
    expect((await handle.execute('SELECT 1', [])).rows).toEqual([{ id: 'x' }]);
    expect((await handle.execute('UPDATE t SET a=1', [])).rowCount).toBe(3);
  });

  it('fromNodeSqlite coerces bigint changes to number', async () => {
    const db = {
      prepare: (_sql: string) => ({
        all: () => [],
        run: () => ({ changes: 5n as unknown as number | bigint }),
      }),
    };
    const handle = fromNodeSqlite(db);
    expect((await handle.execute('DELETE FROM t', [])).rowCount).toBe(5);
  });

  it('fromOracle maps rows/rowsAffected', async () => {
    const handle = fromOracle({
      execute: async () => ({ rows: [{ ID: 1 }], rowsAffected: 1 }),
    });
    expect(handle.engine).toBe('ORACLE');
    expect((await handle.execute('SELECT', [])).rowCount).toBe(1);
  });

  it('fromKnex forwards to trx.raw', async () => {
    const handle = fromKnex({ raw: async () => ({ rows: [{ a: 1 }] }) });
    expect((await handle.execute('SELECT', [])).rows).toEqual([{ a: 1 }]);
  });

  it('isTransactionHandle rejects non-handles', () => {
    expect(isTransactionHandle({})).toBe(false);
    expect(isTransactionHandle(null)).toBe(false);
  });
});
