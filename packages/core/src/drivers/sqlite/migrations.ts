import { TableName } from '../table-names';
import type { FlavourMigration, MigrationNames } from '../shared/migration';
// NOTE: column names and enum values here are intentionally raw string literals, NOT the
// `*Column`/`JobStatus`/`RetentionMode` enums the drivers use. A migration is a frozen record of a
// schema that has already been applied; renaming an enum member must never retroactively rewrite a
// past migration's DDL.

/**
 * Predefined SQLite DDL, version by version. SQLite has no dedicated `BIGINT`/`SMALLINT` — every
 * integer-family column maps to its native `INTEGER` storage class (a 64-bit signed value), string
 * columns to `TEXT`, and the float columns to `REAL`. `CREATE TABLE IF NOT EXISTS` and
 * `CREATE INDEX IF NOT EXISTS` are both native, and a `TEXT PRIMARY KEY` gets its own implicit
 * index. Authored by hand for this engine; not generated at runtime. There is a single version so
 * far — the base schema — but the array is the extension point: a future change appends
 * `{ version: 2, ... }` with its own statement builder rather than editing `v1`, which is a frozen
 * record of what has already been applied.
 *
 * SQLite has no schemas, so the driver takes no `schema` option and nothing here qualifies a name.
 *
 * **Keys and indexes** mirror the Postgres set — same access paths, authored separately in SQLite's
 * own dialect. The one dialect difference is `WHERE` on an index: SQLite supports partial indexes
 * from 3.8, so the same predicates are used.
 */

/** Version 1 — the full base schema, its keys and its indexes. */
function v1(names: MigrationNames): string[] {
  const t = names.name;
  const idx = names.derived;
  return [
    `CREATE TABLE IF NOT EXISTS ${t(TableName.QUEUE)} (
      name TEXT NOT NULL PRIMARY KEY,
      processing_paused INTEGER NOT NULL DEFAULT 0,
      accepting_paused INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.JOB)} (
      id TEXT NOT NULL PRIMARY KEY,
      queue_name TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      data TEXT,
      return_value TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      start_after INTEGER NOT NULL,
      expire_at INTEGER,
      started_at INTEGER,
      completed_at INTEGER,
      failed_at INTEGER,
      retried_at INTEGER,
      stalled_at INTEGER,
      cancelled_at INTEGER,
      expired_at INTEGER,
      locked_until INTEGER,
      preferred_instance_key_pattern TEXT,
      processed_on_instance_key TEXT,
      retry_attempt INTEGER NOT NULL DEFAULT 0,
      retry_max_attempts INTEGER NOT NULL DEFAULT 1,
      retry_delay_seconds INTEGER NOT NULL DEFAULT 0,
      retry_backoff TEXT NOT NULL DEFAULT 'FIXED',
      retry_backoff_factor REAL,
      retry_max_delay_seconds INTEGER,
      retry_jitter INTEGER NOT NULL DEFAULT 0,
      failure_message TEXT,
      retention_mode TEXT NOT NULL DEFAULT 'KEEP_FOREVER',
      retention_ttl_seconds INTEGER,
      retention_statuses TEXT,
      idempotency_key TEXT,
      schedule_id TEXT,
      singleton_key TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.SCHEDULE)} (
      id TEXT NOT NULL PRIMARY KEY,
      queue_name TEXT NOT NULL,
      cron TEXT,
      every_seconds INTEGER,
      timezone TEXT,
      data TEXT,
      job_options TEXT,
      priority INTEGER,
      retry_max_attempts INTEGER,
      retry_delay_seconds INTEGER,
      next_run_at INTEGER,
      last_run_at INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      start_at INTEGER,
      end_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      idempotency_key TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.INSTANCE)} (
      instance_key TEXT NOT NULL PRIMARY KEY,
      processing_paused INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      cpu_percent REAL,
      memory_percent REAL
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.MIGRATION)} (
      version INTEGER NOT NULL PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    // The claim query, in its exact order.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'claim_idx')} ` +
      `ON ${t(TableName.JOB)} (queue_name, status, priority DESC, start_after ASC)`,
    // reclaimStalledJobs.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'stalled_idx')} ` +
      `ON ${t(TableName.JOB)} (status, locked_until)`,
    // expireDueJobs.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'expiry_idx')} ` +
      `ON ${t(TableName.JOB)} (status, expire_at)`,
    // The retention sweep.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'retention_idx')} ` +
      `ON ${t(TableName.JOB)} (status, retention_ttl_seconds) ` +
      `WHERE retention_mode = 'DELETE_AFTER'`,
    // Idempotency dedup (not unique — dedup is enforced in driver code on every engine).
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'idempotency_idx')} ` +
      `ON ${t(TableName.JOB)} (queue_name, idempotency_key) ` +
      `WHERE idempotency_key IS NOT NULL`,
    // Singleton dedup.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'singleton_idx')} ` +
      `ON ${t(TableName.JOB)} (queue_name, singleton_key, status) ` +
      `WHERE singleton_key IS NOT NULL`,
    // The newest-first job page.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'created_idx')} ` +
      `ON ${t(TableName.JOB)} (created_at DESC)`,
    // Jobs a schedule produced.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'schedule_idx')} ` +
      `ON ${t(TableName.JOB)} (schedule_id) WHERE schedule_id IS NOT NULL`,
    // Per-instance attribution.
    `CREATE INDEX IF NOT EXISTS ${idx(TableName.JOB, 'instance_idx')} ` +
      `ON ${t(TableName.JOB)} (processed_on_instance_key, status) ` +
      `WHERE processed_on_instance_key IS NOT NULL`,
    // getDueSchedules.
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
  ];
}

export const SQLITE_MIGRATIONS: FlavourMigration[] = [{ version: 1, statements: v1 }];
