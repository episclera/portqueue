import { DatabaseEngine } from '../options/enums';
import { TableName } from './table-names';
import { PostgresDriver } from './postgres/postgres-driver';
import { PgliteDriver } from './pglite/pglite-driver';
import { SqliteDriver } from './sqlite/sqlite-driver';
import { OracleDriver } from './oracle/oracle-driver';
import { MysqlDriver } from './mysql/mysql-driver';
import { CitusDriver } from './citus/citus-driver';
import { YugabyteDriver } from './yugabyte/yugabyte-driver';
import { POSTGRES_MIGRATIONS } from './postgres/migrations';
import { PGLITE_MIGRATIONS } from './pglite/migrations';
import { SQLITE_MIGRATIONS } from './sqlite/migrations';
import { ORACLE_MIGRATIONS } from './oracle/migrations';
import { MYSQL_MIGRATIONS } from './mysql/migrations';
import { CITUS_MIGRATIONS } from './citus/migrations';
import { YUGABYTE_MIGRATIONS } from './yugabyte/migrations';
import type { FlavourMigration } from './shared/migration';

const bare = (t: TableName): string => `pq_${t}`;
const v1 = (set: FlavourMigration[]): string[] => set.find((m) => m.version === 1)!.statements(bare);

describe('per-engine migrations (authored alongside each driver)', () => {
  it('each engine authors its own migration set — separate arrays, never shared', () => {
    const sets = [
      POSTGRES_MIGRATIONS,
      PGLITE_MIGRATIONS,
      SQLITE_MIGRATIONS,
      ORACLE_MIGRATIONS,
      MYSQL_MIGRATIONS,
      CITUS_MIGRATIONS,
      YUGABYTE_MIGRATIONS,
    ];
    // No two engines share the same array object — a change to one never leaks into another.
    expect(new Set(sets).size).toBe(sets.length);
    // Every set declares the same versions with the same checksums (same logical schema).
    for (const set of sets) {
      expect(set.map((m) => m.version)).toEqual([1, 2]);
      expect(set.map((m) => m.checksum)).toEqual([
        'v1-base-schema',
        'v2-schedule-idempotency-key',
      ]);
    }
  });

  it('each driver exposes runner steps built from its own migrations', () => {
    const drivers = [
      [new PostgresDriver(), DatabaseEngine.POSTGRES],
      [new PgliteDriver(), DatabaseEngine.PGLITE],
      [new SqliteDriver(), DatabaseEngine.SQLITE],
      [new OracleDriver(), DatabaseEngine.ORACLE],
      [new MysqlDriver(), DatabaseEngine.MYSQL],
      [new CitusDriver(), DatabaseEngine.CITUS],
      [new YugabyteDriver(), DatabaseEngine.YUGABYTE],
    ] as const;
    for (const [driver, engine] of drivers) {
      expect(driver.engine).toBe(engine);
      expect(driver.migrations.map((m) => m.version)).toEqual([1, 2]);
    }
  });

  it('Postgres v1 creates every table with the pruned job shape; v2 adds the schedule key', () => {
    const statements = v1(POSTGRES_MIGRATIONS);
    expect(statements).toHaveLength(5);
    expect(statements.every((s) => s.startsWith('CREATE TABLE IF NOT EXISTS'))).toBe(true);
    const job = statements.find((s) => s.includes('pq_job'))!;
    expect(job).toContain('preferred_instance_key_pattern');
    expect(job).not.toMatch(/preferred_instance_key\b/);
    const v2 = POSTGRES_MIGRATIONS.find((m) => m.version === 2)!.statements(bare);
    expect(v2).toEqual(['ALTER TABLE pq_schedule ADD COLUMN idempotency_key TEXT']);
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

  it('Oracle authors its own dialect: PL/SQL create guards, VARCHAR2/NUMBER/CLOB, ADD (col)', () => {
    const statements = v1(ORACLE_MIGRATIONS);
    expect(statements.every((s) => s.includes('EXECUTE IMMEDIATE') && s.includes('-955'))).toBe(
      true,
    );
    const job = statements.find((s) => s.includes('pq_job'))!;
    expect(job).toContain('NUMBER(19)');
    expect(job).toContain('data CLOB');
    expect(job).not.toMatch(/\bTEXT\b|\bBIGINT\b/);
    const v2 = ORACLE_MIGRATIONS.find((m) => m.version === 2)!.statements(bare)[0]!;
    expect(v2).toContain('ADD (idempotency_key VARCHAR2(4000))');
  });

  it('Citus authors the base tables plus create_distributed_table shard declarations', () => {
    const statements = v1(CITUS_MIGRATIONS);
    expect(statements.filter((s) => s.startsWith('CREATE TABLE IF NOT EXISTS'))).toHaveLength(5);
    expect(statements).toContain("SELECT create_distributed_table('pq_queue', 'name')");
    expect(statements).toContain("SELECT create_reference_table('pq_migration')");
  });

  it('PGLite and Yugabyte match Postgres statement text (PG-wire) but from their own arrays', () => {
    for (const set of [PGLITE_MIGRATIONS, YUGABYTE_MIGRATIONS]) {
      expect(set).not.toBe(POSTGRES_MIGRATIONS);
      expect(v1(set)).toEqual(v1(POSTGRES_MIGRATIONS));
    }
  });
});
