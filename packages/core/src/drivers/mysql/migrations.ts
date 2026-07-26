import { TableName } from '../table-names';
import type { FlavourMigration, PhysicalName } from '../shared/migration';
// NOTE: column names here are intentionally raw string literals, NOT the `*Column` enums used
// by the drivers. A migration is a frozen record of a schema that has already been applied;
// renaming an enum member must never retroactively rewrite a past migration's DDL.

/**
 * Predefined MySQL DDL, authored in full for this engine. It differs from the Postgres flavour in
 * two engine-specific ways: MySQL forbids a `DEFAULT` on `TEXT`/`BLOB` columns, so the two
 * defaulted text columns (`retry_backoff`, `retention_mode`) are `VARCHAR`. `REAL` is MySQL's
 * synonym for `DOUBLE`; `BIGINT`/`INTEGER`/`SMALLINT`/`TEXT` are native. Authored by hand for this engine; not generated at runtime.
 * There is a single version so far — the base schema — but the array is the extension point: a
 * future change appends `{ version: 2, ... }` with its own statement builder rather than editing
 * `v1`, which is a frozen record of what has already been applied.
 */

/** Version 1 — the full base schema. */
function v1(t: PhysicalName): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${t(TableName.QUEUE)} (
      name TEXT NOT NULL,
      processing_paused SMALLINT NOT NULL DEFAULT 0,
      accepting_paused SMALLINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.JOB)} (
      id TEXT NOT NULL,
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
      preferred_instance_key_pattern TEXT,
      processed_on_instance_key TEXT,
      retry_attempt INTEGER NOT NULL DEFAULT 0,
      retry_max_attempts INTEGER NOT NULL DEFAULT 1,
      retry_delay_seconds BIGINT NOT NULL DEFAULT 0,
      retry_backoff VARCHAR(32) NOT NULL DEFAULT 'FIXED',
      retry_backoff_factor REAL,
      retry_max_delay_seconds BIGINT,
      retry_jitter SMALLINT NOT NULL DEFAULT 0,
      failure_message TEXT,
      retention_mode VARCHAR(32) NOT NULL DEFAULT 'KEEP_FOREVER',
      retention_ttl_seconds BIGINT,
      idempotency_key TEXT,
      schedule_id TEXT,
      singleton_key TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.SCHEDULE)} (
      id TEXT NOT NULL,
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
      start_at BIGINT,
      end_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      idempotency_key TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.INSTANCE)} (
      instance_key TEXT NOT NULL,
      processing_paused SMALLINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.MIGRATION)} (
      version INTEGER NOT NULL,
      applied_at BIGINT NOT NULL,
      checksum TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`,
  ];
}

export const MYSQL_MIGRATIONS: FlavourMigration[] = [
  { version: 1, checksum: 'v1-base-schema', statements: v1 },
];
