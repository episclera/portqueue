import { TableName } from '../table-names';
import type { FlavourMigration, MigrationNames } from '../shared/migration';
// NOTE: column names, statuses and enum values here are intentionally raw string literals, NOT the
// `*Column`/`JobStatus` enums the drivers use. A migration is a frozen record of a
// schema that has already been applied; renaming an enum member must never retroactively rewrite a
// past migration's DDL.

/**
 * Predefined PostgreSQL DDL, version by version. Authored by hand for this engine; not generated at
 * runtime. There is a single version so far — the base schema — but the array is the extension
 * point: a future change appends `{ version: 2, ... }` with its own statement builder rather than
 * editing `v1`, which is a frozen record of what has already been applied.
 *
 * The statement builders are exported because PGLite is PostgreSQL compiled to WASM and reuses them
 * verbatim (see `../pglite/migrations.ts`) — every other engine authors its own copy under its own
 * folder, so a change here reaches PostgreSQL and PGLite and no one else.
 *
 * **Keys and indexes.** PostgreSQL is a capable engine, so the schema uses them: a primary key per
 * table (which is also what makes `INSERT … ON CONFLICT DO NOTHING` a legal get-or-create for the
 * queue and instance rows), plus one index per hot access path — the claim query, the two
 * maintenance sweeps, the retention sweep, both dedup lookups, the newest-first job page and the
 * due-schedule scan. Nothing beyond the primary keys is a *uniqueness* constraint: idempotency and
 * singleton dedup stay enforced in driver code, so behaviour is identical on an engine that cannot
 * honour such a constraint — and so a dedup never surfaces as a constraint violation.
 */

/** Version 1 — the full base schema, its keys and its indexes. */
export function v1(names: MigrationNames): string[] {
  const t = names.name;
  const idx = names.derived;
  const statements: string[] = [];

  // The schema must exist before anything can be created in it. Only emitted when one was asked
  // for; without a `schema` option every object lands in the connection's search path as before.
  if (names.schema) statements.push(`CREATE SCHEMA IF NOT EXISTS ${names.schema}`);

  statements.push(
    `CREATE TABLE IF NOT EXISTS ${t(TableName.QUEUE)} (
      name TEXT NOT NULL PRIMARY KEY,
      processing_paused SMALLINT NOT NULL DEFAULT 0,
      accepting_paused SMALLINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.JOB)} (
      id TEXT NOT NULL PRIMARY KEY,
      queue_name TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      data TEXT,
      return_value TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      start_after BIGINT NOT NULL,
      expire_at BIGINT,
      started_at BIGINT,
      completed_at BIGINT,
      failed_at BIGINT,
      retried_at BIGINT,
      stalled_at BIGINT,
      cancelled_at BIGINT,
      expired_at BIGINT,
      locked_until BIGINT,
      lock_token TEXT,
      preferred_instance_key_pattern TEXT,
      processed_on_instance_key TEXT,
      retry_attempt INTEGER NOT NULL DEFAULT 0,
      retry_max_attempts INTEGER NOT NULL DEFAULT 1,
      retry_delay_seconds BIGINT NOT NULL DEFAULT 0,
      retry_backoff TEXT NOT NULL DEFAULT 'FIXED',
      retry_backoff_factor REAL,
      retry_max_delay_seconds BIGINT,
      retry_jitter SMALLINT NOT NULL DEFAULT 0,
      failure_message TEXT,
      retention_ttl_seconds BIGINT,
      retention_statuses INTEGER,
      idempotency_key TEXT,
      schedule_id TEXT,
      singleton_key TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.SCHEDULE)} (
      id TEXT NOT NULL PRIMARY KEY,
      queue_name TEXT NOT NULL,
      cron TEXT,
      every_seconds BIGINT,
      timezone TEXT,
      data TEXT,
      job_options TEXT,
      priority INTEGER,
      retry_max_attempts INTEGER,
      retry_delay_seconds BIGINT,
      next_run_at BIGINT,
      last_run_at BIGINT,
      enabled SMALLINT NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      idempotency_key TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.INSTANCE)} (
      instance_key TEXT NOT NULL PRIMARY KEY,
      processing_paused SMALLINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL,
      cpu_percent REAL,
      memory_percent REAL
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.MIGRATION)} (
      version INTEGER NOT NULL PRIMARY KEY,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`,
  );

  // Index names stay unqualified: PostgreSQL files an index in its table's own schema, and naming
  // the schema on both sides of `CREATE INDEX … ON …` is an error.
  statements.push(
    // The claim query, in its exact order: narrow by queue and claimable status, then take the
    // highest priority and oldest due row.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'claim_idx')} ` +
      `ON ${t(TableName.JOB)} (queue_name, status, priority DESC, start_after ASC)`,
    // reclaimStalledJobs: ACTIVE rows whose lock has lapsed.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'stalled_idx')} ` +
      `ON ${t(TableName.JOB)} (status, locked_until)`,
    // expireDueJobs: due-but-unstarted rows past their deadline.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'expiry_idx')} ` +
      `ON ${t(TableName.JOB)} (status, expire_at)`,
    // The retention sweep, which only ever looks at rows that carry a TTL and are finished.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'retention_idx')} ` +
      `ON ${t(TableName.JOB)} (status, retention_ttl_seconds) ` +
      `WHERE retention_ttl_seconds IS NOT NULL`,
    // Idempotency dedup.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'idempotency_idx')} ` +
      `ON ${t(TableName.JOB)} (queue_name, idempotency_key) ` +
      `WHERE idempotency_key IS NOT NULL`,
    // Singleton dedup, which also filters on the "holds a slot" statuses.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'singleton_idx')} ` +
      `ON ${t(TableName.JOB)} (queue_name, singleton_key, status) ` +
      `WHERE singleton_key IS NOT NULL`,
    // The newest-first job page every list read uses.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'created_idx')} ` +
      `ON ${t(TableName.JOB)} (created_at DESC)`,
    // Jobs a schedule produced (the schedule detail view).
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'schedule_idx')} ` +
      `ON ${t(TableName.JOB)} (schedule_id) WHERE schedule_id IS NOT NULL`,
    // Per-instance attribution: the instance detail view and its grouped counts.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'instance_idx')} ` +
      `ON ${t(TableName.JOB)} (processed_on_instance_key, status) ` +
      `WHERE processed_on_instance_key IS NOT NULL`,
    // getDueSchedules: armed schedules whose next run has arrived.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.SCHEDULE, 'due_idx')} ` +
      `ON ${t(TableName.SCHEDULE)} (enabled, next_run_at)`,
    // Schedules of one queue, in the list's own order.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.SCHEDULE, 'queue_idx')} ` +
      `ON ${t(TableName.SCHEDULE)} (queue_name, created_at)`,
    // The schedule dedup lookup.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.SCHEDULE, 'idempotency_idx')} ` +
      `ON ${t(TableName.SCHEDULE)} (queue_name, idempotency_key) ` +
      `WHERE idempotency_key IS NOT NULL`,
    // The instance list's liveness filter.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.INSTANCE, 'seen_idx')} ` +
      `ON ${t(TableName.INSTANCE)} (last_seen_at)`,
  );

  return statements;
}

/**
 * Version 2 — partial indexes for the three hot predicates.
 *
 * - **The claim.** v1's `claim_idx` keyed on `status`, so the claim's `status IN ('PENDING','RETRY')`
 *   matched two ranges of the index and PostgreSQL had to read and sort *every* waiting row before
 *   it could apply the `LIMIT` — a claim got slower with every job in the backlog (10 ms at 10 000
 *   waiting rows). Moving the status test into the index predicate leaves `(queue_name, priority
 *   DESC, start_after)` as the key, which is exactly the claim's `ORDER BY`, so the scan stops after
 *   `LIMIT` rows (0.2 ms at the same backlog). The claim binds its statuses as parameters; an
 *   unnamed statement is planned with their values, which is what lets the planner prove the
 *   predicate.
 * - **The stalled sweep** only ever looks at `ACTIVE` rows, and **the expiry sweep** only at rows
 *   that carry an `expire_at`, so both become partial too.
 *
 * Fewer rows in each index is also fewer index writes: every claim and settle changes `status`, which
 * PostgreSQL cannot do as a HOT update, so each status change writes an entry into every index whose
 * predicate the row satisfies. A finished row now sits in none of these three.
 *
 * Column names are literals, never the `*Column` enums: this is a frozen record of applied DDL.
 */
export function v2(names: MigrationNames): string[] {
  const t = names.name;
  const idx = names.derived;
  // `DROP INDEX` names the index itself, which lives in its table's schema; `CREATE INDEX` names it
  // bare (see v1).
  const drop = (suffix: string): string =>
    `DROP INDEX IF EXISTS ${names.schema ? `${names.schema}.` : ''}${idx(TableName.JOB, suffix)}`;
  return [
    drop('claim_idx'),
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'claim_idx')} ` +
      `ON ${t(TableName.JOB)} (queue_name, priority DESC, start_after ASC) ` +
      `WHERE status IN ('PENDING', 'RETRY')`,
    drop('stalled_idx'),
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'stalled_idx')} ` +
      `ON ${t(TableName.JOB)} (locked_until) WHERE status = 'ACTIVE'`,
    drop('expiry_idx'),
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'expiry_idx')} ` +
      `ON ${t(TableName.JOB)} (status, expire_at) WHERE expire_at IS NOT NULL`,
  ];
}

export const POSTGRESQL_MIGRATIONS: FlavourMigration[] = [
  { version: 1, statements: v1 },
  { version: 2, statements: v2 },
];
