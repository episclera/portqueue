import { TableName } from '../table-names';
import type { FlavourMigration, PhysicalName } from '../shared/migration';
// NOTE: column names here are intentionally raw string literals, NOT the `*Column` enums used
// by the drivers. A migration is a frozen record of a schema that has already been applied;
// renaming an enum member must never retroactively rewrite a past migration's DDL.

/**
 * Predefined SQLite DDL, version by version. SQLite has no dedicated `BIGINT`/`SMALLINT` — every
 * integer-family column maps to its native `INTEGER` storage class (a 64-bit signed value), string
 * columns to `TEXT`, and the one float column to `REAL`. `CREATE TABLE IF NOT EXISTS` and
 * `ALTER TABLE ADD COLUMN` are both native. Authored by hand for this engine;
 * not generated at runtime. There is a single version so far — the base schema — but the array is
 * the extension point: a future change appends `{ version: 2, ... }` with its own statement builder
 * rather than editing `v1`, which is a frozen record of what has already been applied.
 */

/** Version 1 — the full base schema. */
function v1(t: PhysicalName): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${t(TableName.QUEUE)} (
      name TEXT NOT NULL,
      processing_paused INTEGER NOT NULL DEFAULT 0,
      accepting_paused INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.JOB)} (
      id TEXT NOT NULL,
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
      retry_delay_seconds REAL NOT NULL DEFAULT 0,
      retry_backoff TEXT NOT NULL DEFAULT 'FIXED',
      retry_backoff_factor REAL,
      retry_max_delay_seconds REAL,
      retry_jitter INTEGER NOT NULL DEFAULT 0,
      failure_message TEXT,
      retention_mode TEXT NOT NULL DEFAULT 'KEEP_FOREVER',
      retention_ttl_seconds REAL,
      idempotency_key TEXT,
      schedule_id TEXT,
      singleton_key TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.SCHEDULE)} (
      id TEXT NOT NULL,
      queue_name TEXT NOT NULL,
      cron TEXT,
      every_seconds REAL,
      timezone TEXT,
      data TEXT,
      job_options TEXT,
      priority INTEGER,
      retry_max_attempts INTEGER,
      retry_delay_seconds REAL,
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
      instance_key TEXT NOT NULL,
      processing_paused INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.MIGRATION)} (
      version INTEGER NOT NULL,
      applied_at INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ];
}

export const SQLITE_MIGRATIONS: FlavourMigration[] = [
  { version: 1, checksum: 'v1-base-schema', statements: v1 },
];
