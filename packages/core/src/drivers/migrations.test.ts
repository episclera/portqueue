import { DatabaseEngine } from '../options/enums';
import { TableName } from './table-names';
import { PostgresDriver } from './postgres/postgres-driver';
import { PgliteDriver } from './pglite/pglite-driver';
import { SqliteDriver } from './sqlite/sqlite-driver';
import { OracleDriver } from './oracle/oracle-driver';
import { MysqlDriver } from './mysql/mysql-driver';
import { POSTGRES_MIGRATIONS } from './postgres/migrations';
import { PGLITE_MIGRATIONS } from './pglite/migrations';
import { SQLITE_MIGRATIONS } from './sqlite/migrations';
import { ORACLE_MIGRATIONS } from './oracle/migrations';
import { MYSQL_MIGRATIONS } from './mysql/migrations';
import type { FlavourMigration } from './shared/migration';

const bare = (t: TableName): string => `pq_${t}`;
const v1 = (set: FlavourMigration[]): string[] =>
  set.find((m) => m.version === 1)!.statements(bare);

describe('per-engine migrations (authored alongside each driver)', () => {
  it('each engine authors its own migration set — separate arrays, never shared', () => {
    const sets = [
      POSTGRES_MIGRATIONS,
      PGLITE_MIGRATIONS,
      SQLITE_MIGRATIONS,
      ORACLE_MIGRATIONS,
      MYSQL_MIGRATIONS,
    ];
    // No two engines share the same array object, so adding a version to one never adds it to
    // another. (PG-wire is the one place where the statement builders themselves are reused — see
    // the PGLite case below.)
    expect(new Set(sets).size).toBe(sets.length);
    // Every set declares the same versions with the same checksums (same logical schema).
    for (const set of sets) {
      expect(set.map((m) => m.version)).toEqual([1]);
      expect(set.map((m) => m.checksum)).toEqual(['v1-base-schema']);
    }
  });

  it('each driver exposes runner steps built from its own migrations', () => {
    const drivers = [
      [new PostgresDriver(), DatabaseEngine.POSTGRES],
      [new PgliteDriver(), DatabaseEngine.PGLITE],
      [new SqliteDriver(), DatabaseEngine.SQLITE],
      [new OracleDriver(), DatabaseEngine.ORACLE],
      [new MysqlDriver(), DatabaseEngine.MYSQL],
    ] as const;
    for (const [driver, engine] of drivers) {
      expect(driver.engine).toBe(engine);
      expect(driver.migrations.map((m) => m.version)).toEqual([1]);
    }
  });

  it('Postgres v1 creates every table with the pruned job shape and the schedule dedup token', () => {
    const statements = v1(POSTGRES_MIGRATIONS);
    expect(statements).toHaveLength(5);
    expect(statements.every((s) => s.startsWith('CREATE TABLE IF NOT EXISTS'))).toBe(true);
    const job = statements.find((s) => s.includes('pq_job'))!;
    expect(job).toContain('preferred_instance_key_pattern');
    expect(job).not.toMatch(/preferred_instance_key\b/);
    // The schedule dedup token is part of the base schema — no follow-up ALTER version.
    expect(statements.find((s) => s.includes('pq_schedule'))!).toContain('idempotency_key TEXT');
  });

  it('MySQL avoids DEFAULT on TEXT by using VARCHAR for defaulted string columns', () => {
    const job = v1(MYSQL_MIGRATIONS).find((s) => s.includes('pq_job'))!;
    expect(job).toContain("retry_backoff VARCHAR(32) NOT NULL DEFAULT 'FIXED'");
    expect(job).not.toMatch(/TEXT NOT NULL DEFAULT/);
  });

  it('SQLite authors native INTEGER columns rather than BIGINT/SMALLINT', () => {
    const job = v1(SQLITE_MIGRATIONS).find((s) => s.includes('pq_job'))!;
    expect(job).toContain('created_at INTEGER NOT NULL');
    expect(job).not.toMatch(/BIGINT|SMALLINT/);
  });

  it('Oracle authors its own dialect: PL/SQL create guards, VARCHAR2/NUMBER/CLOB', () => {
    const statements = v1(ORACLE_MIGRATIONS);
    expect(statements.every((s) => s.includes('EXECUTE IMMEDIATE') && s.includes('-955'))).toBe(
      true,
    );
    const job = statements.find((s) => s.includes('pq_job'))!;
    expect(job).toContain('NUMBER(19)');
    expect(job).toContain('data CLOB');
    expect(job).not.toMatch(/\bTEXT\b|\bBIGINT\b/);
    expect(statements.find((s) => s.includes('pq_schedule'))!).toContain(
      'idempotency_key VARCHAR2(4000)',
    );
  });

  it('PGLite reuses the Postgres statement builders (PG-wire) from its own array', () => {
    expect(PGLITE_MIGRATIONS).not.toBe(POSTGRES_MIGRATIONS);
    // Same builder object, not a hand-kept copy: the two can never drift.
    expect(PGLITE_MIGRATIONS[0]!.statements).toBe(POSTGRES_MIGRATIONS[0]!.statements);
    expect(v1(PGLITE_MIGRATIONS)).toEqual(v1(POSTGRES_MIGRATIONS));
  });
});
