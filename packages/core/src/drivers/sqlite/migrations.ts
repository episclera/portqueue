import { TableName } from '../table-names.js';
import type { FlavourMigration, PhysicalName } from '../shared/migration.js';

/**
 * Predefined SQLite DDL, version by version. SQLite has no dedicated `BIGINT`/`SMALLINT` — every
 * integer-family column maps to its native `INTEGER` storage class (a 64-bit signed value), string
 * columns to `TEXT`, and the one float column to `REAL`. `CREATE TABLE IF NOT EXISTS` and
 * `ALTER TABLE ADD COLUMN` are both native. Authored by hand for this engine;
 * not generated at runtime.
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
      metadata TEXT,
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
      locked_by_instance_id TEXT,
      preferred_instance_key_pattern TEXT,
      processed_on_instance_key TEXT,
      retry_attempt INTEGER NOT NULL DEFAULT 0,
      retry_max_attempts INTEGER NOT NULL DEFAULT 1,
      retry_delay_ms INTEGER NOT NULL DEFAULT 0,
      retry_backoff TEXT NOT NULL DEFAULT 'FIXED',
      retry_backoff_factor REAL,
      retry_max_delay_ms INTEGER,
      retry_jitter INTEGER NOT NULL DEFAULT 0,
      failure_message TEXT,
      retention_mode TEXT NOT NULL DEFAULT 'KEEP_FOREVER',
      retention_ttl_ms INTEGER,
      idempotency_key TEXT,
      schedule_id TEXT,
      singleton_key TEXT,
      workflow_id TEXT,
      workflow_step_key TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.SCHEDULE)} (
      id TEXT NOT NULL,
      queue_name TEXT NOT NULL,
      cron TEXT,
      every_ms INTEGER,
      timezone TEXT,
      data TEXT,
      priority INTEGER,
      retry_max_attempts INTEGER,
      retry_delay_ms INTEGER,
      next_run_at INTEGER,
      last_run_at INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      start_at INTEGER,
      end_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
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

/** Version 2 — add the schedule cross-table dedup token. */
function v2(t: PhysicalName): string[] {
  return [`ALTER TABLE ${t(TableName.SCHEDULE)} ADD COLUMN idempotency_key TEXT`];
}

export const SQLITE_MIGRATIONS: FlavourMigration[] = [
  { version: 1, checksum: 'v1-base-schema', statements: v1 },
  { version: 2, checksum: 'v2-schedule-idempotency-key', statements: v2 },
];
