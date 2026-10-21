import { DatabaseEngine } from '../options/enums';
import { TableName } from './table-names';
import { PostgresqlDriver } from './postgresql/postgresql-driver';
import { PgliteDriver } from './pglite/pglite-driver';
import { SqliteDriver } from './sqlite/sqlite-driver';
import { OracleDriver } from './oracle/oracle-driver';
import { MysqlDriver } from './mysql/mysql-driver';
import { POSTGRESQL_MIGRATIONS } from './postgresql/migrations';
import { PGLITE_MIGRATIONS } from './pglite/migrations';
import { SQLITE_MIGRATIONS } from './sqlite/migrations';
import { ORACLE_MIGRATIONS } from './oracle/migrations';
import { MYSQL_MIGRATIONS } from './mysql/migrations';
import type { FlavourMigration } from './shared/migration';

/** The naming helpers a migration builder is handed, with no schema configured. */
const names = {
  name: (t: TableName): string => `pq_${t}`,
  derived: (t: TableName, suffix: string): string => `pq_${t}_${suffix}`,
  schema: undefined,
};
const v1 = (set: FlavourMigration[]): string[] =>
  set.find((m) => m.version === 1)!.statements(names);
/** Just the `CREATE TABLE` statements — index/constraint DDL is asserted separately. */
const tables = (statements: string[]): string[] => statements.filter((s) => /CREATE TABLE/.test(s));

describe('per-engine migrations (authored alongside each driver)', () => {
  it('each engine authors its own migration set — separate arrays, never shared', () => {
    const sets = [
      POSTGRESQL_MIGRATIONS,
      PGLITE_MIGRATIONS,
      SQLITE_MIGRATIONS,
      ORACLE_MIGRATIONS,
      MYSQL_MIGRATIONS,
    ];
    // No two engines share the same array object, so adding a version to one never adds it to
    // another. (PG-wire is the one place where the statement builders themselves are reused — see
    // the PGLite case below.)
    expect(new Set(sets).size).toBe(sets.length);
    // Every set declares the same versions (the same logical schema). A migration is identified by
    // its version alone — there is deliberately no checksum for anything to compare.
    for (const set of sets) {
      expect(set.map((m) => m.version)).toEqual([1]);
      expect(set.every((m) => !('checksum' in m))).toBe(true);
    }
  });

  it('each driver exposes runner steps built from its own migrations', () => {
    const drivers = [
      [new PostgresqlDriver(), DatabaseEngine.POSTGRESQL],
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

  it('PostgreSQL v1 creates every table with the pruned job shape and the schedule dedup token', () => {
    const statements = v1(POSTGRESQL_MIGRATIONS);
    const created = tables(statements);
    expect(created).toHaveLength(5);
    expect(created.every((s) => s.startsWith('CREATE TABLE IF NOT EXISTS'))).toBe(true);
    const job = created.find((s) => s.includes('pq_job'))!;
    expect(job).toContain('preferred_instance_key_pattern');
    expect(job).not.toMatch(/preferred_instance_key\b/);
    // The retention scope travels with the job, so its policy can't be re-read from the queue.
    expect(job).toContain('retention_statuses');
    // A column no query references is not in the schema.
    expect(job).not.toMatch(/\bmetadata\b/);
    // The schedule dedup token is part of the base schema — no follow-up ALTER version.
    expect(created.find((s) => s.includes('pq_schedule'))!).toContain('idempotency_key TEXT');
    // The migration table records the version and when the row was written — nothing else. No
    // checksum (nothing ever compared one) and no `applied_at` beside `created_at`, which already
    // says when the version was applied.
    const migration = created.find((s) => s.includes('pq_migration'))!;
    expect(migration).not.toContain('checksum');
    expect(migration).not.toContain('applied_at');
    expect(migration).toContain('created_at');
  });

  it('PostgreSQL v1 declares a primary key per table and an index per hot access path', () => {
    const statements = v1(POSTGRESQL_MIGRATIONS);
    for (const table of tables(statements)) expect(table).toContain('PRIMARY KEY');
    const indexes = statements.filter((s) => s.startsWith('CREATE INDEX'));
    // Every index is idempotent and unqualified (PostgreSQL files it in the table's own schema).
    expect(indexes.every((s) => s.startsWith('CREATE INDEX IF NOT EXISTS pq_'))).toBe(true);
    // The claim query's exact shape: queue + claimable status, then priority and due order.
    expect(indexes.join('\n')).toContain('(queue_name, status, priority DESC, start_after ASC)');
    for (const path of [
      'pq_job_claim_idx',
      'pq_job_stalled_idx',
      'pq_job_expiry_idx',
      'pq_job_retention_idx',
      'pq_job_idempotency_idx',
      'pq_job_singleton_idx',
      'pq_job_created_idx',
      'pq_schedule_due_idx',
      'pq_instance_seen_idx',
    ]) {
      expect(indexes.some((s) => s.includes(path))).toBe(true);
    }
    // Dedup stays enforced in driver code, so neither key gets a UNIQUE index.
    expect(indexes.every((s) => !s.includes('UNIQUE'))).toBe(true);
  });

  it('creates the schema itself only when one was configured', () => {
    expect(v1(POSTGRESQL_MIGRATIONS).some((s) => s.startsWith('CREATE SCHEMA'))).toBe(false);
    const scoped = POSTGRESQL_MIGRATIONS[0]!.statements({
      name: (t) => `jobs.pq_${t}`,
      derived: (t, suffix) => `pq_${t}_${suffix}`,
      schema: 'jobs',
    });
    expect(scoped[0]).toBe('CREATE SCHEMA IF NOT EXISTS jobs');
    // Tables are qualified; the index names they carry are not.
    expect(scoped.find((s) => s.includes('CREATE TABLE'))!).toContain('jobs.pq_queue');
    expect(scoped.find((s) => s.startsWith('CREATE INDEX'))!).toMatch(
      /CREATE INDEX IF NOT EXISTS pq_job_\w+ ON jobs\.pq_job/,
    );
  });

  it('MySQL declares its indexes inline, having no CREATE INDEX IF NOT EXISTS', () => {
    const statements = v1(MYSQL_MIGRATIONS);
    expect(statements.every((s) => !s.startsWith('CREATE INDEX'))).toBe(true);
    const job = statements.find((s) => s.includes('pq_job'))!;
    expect(job).toContain('PRIMARY KEY (id)');
    expect(job).toContain(
      'KEY pq_job_claim_idx (queue_name, status, priority DESC, start_after ASC)',
    );
    // An indexed column cannot be TEXT on MySQL without a prefix length.
    expect(job).toContain('queue_name VARCHAR(255) NOT NULL');
    // No partial indexes on MySQL, so no predicate rides along.
    expect(job).not.toMatch(/KEY[^,]*WHERE/);
  });

  it('MySQL avoids DEFAULT on TEXT by using VARCHAR for defaulted string columns', () => {
    const job = v1(MYSQL_MIGRATIONS).find((s) => s.includes('pq_job'))!;
    expect(job).toContain("retry_backoff VARCHAR(32) NOT NULL DEFAULT 'FIXED'");
    expect(job).not.toMatch(/TEXT NOT NULL DEFAULT/);
  });

  it('SQLite authors native INTEGER columns rather than BIGINT/SMALLINT', () => {
    const statements = v1(SQLITE_MIGRATIONS);
    const job = tables(statements).find((s) => s.includes('pq_job'))!;
    expect(job).toContain('created_at INTEGER NOT NULL');
    expect(job).not.toMatch(/BIGINT|SMALLINT/);
    expect(job).toContain('id TEXT NOT NULL PRIMARY KEY');
    // Same access paths as PostgreSQL, authored separately in SQLite's own dialect.
    expect(statements.some((s) => s.includes('CREATE INDEX IF NOT EXISTS pq_job_claim_idx'))).toBe(
      true,
    );
  });

  it('Oracle authors its own dialect: PL/SQL create guards, VARCHAR2/NUMBER/CLOB', () => {
    const statements = v1(ORACLE_MIGRATIONS);
    // Oracle has no IF NOT EXISTS on anything, so every statement swallows "already exists".
    expect(statements.every((s) => s.includes('EXECUTE IMMEDIATE') && s.includes('-955'))).toBe(
      true,
    );
    const job = statements.find((s) => s.includes('CREATE TABLE pq_job'))!;
    expect(job).toContain('NUMBER(19)');
    expect(job).toContain('data CLOB');
    expect(job).not.toMatch(/\bTEXT\b|\bBIGINT\b/);
    expect(job).toContain('CONSTRAINT pq_job_pk PRIMARY KEY (id)');
    // 255, not 4000: an Oracle composite B-tree key may not exceed ~40% of the block size.
    expect(job).toContain('queue_name VARCHAR2(255) NOT NULL');
    expect(statements.find((s) => s.includes('CREATE TABLE pq_schedule'))!).toContain(
      'idempotency_key VARCHAR2(255)',
    );
    expect(statements.some((s) => s.includes('CREATE INDEX pq_job_claim_idx'))).toBe(true);
    // Oracle has no LIMIT, so nothing here may emit one.
    expect(statements.every((s) => !/\bLIMIT\b/.test(s))).toBe(true);
  });

  it('PGLite reuses the PostgreSQL statement builders (PG-wire) from its own array', () => {
    expect(PGLITE_MIGRATIONS).not.toBe(POSTGRESQL_MIGRATIONS);
    // Same builder object, not a hand-kept copy: the two can never drift.
    expect(PGLITE_MIGRATIONS[0]!.statements).toBe(POSTGRESQL_MIGRATIONS[0]!.statements);
    expect(v1(PGLITE_MIGRATIONS)).toEqual(v1(POSTGRESQL_MIGRATIONS));
  });
});
