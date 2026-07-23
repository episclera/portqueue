import { TableName } from '../../table-names.js';
import type { FlavourMigration, PhysicalName } from '../types.js';

/**
 * Predefined MySQL DDL. It mirrors the Postgres set with two engine-specific changes: MySQL
 * forbids a `DEFAULT` on `TEXT`/`BLOB` columns, so the two defaulted text columns (`retry_backoff`,
 * `retention_mode`) are `VARCHAR`. `REAL` is MySQL's synonym for `DOUBLE`; `BIGINT`/`INTEGER`/
 * `SMALLINT`/`TEXT` are native. Authored from the JSON schema; not generated at runtime.
 */

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
      metadata TEXT,
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
      locked_by_instance_id TEXT,
      preferred_instance_key_pattern TEXT,
      processed_on_instance_key TEXT,
      retry_attempt INTEGER NOT NULL DEFAULT 0,
      retry_max_attempts INTEGER NOT NULL DEFAULT 1,
      retry_delay_ms BIGINT NOT NULL DEFAULT 0,
      retry_backoff VARCHAR(32) NOT NULL DEFAULT 'FIXED',
      retry_backoff_factor REAL,
      retry_max_delay_ms BIGINT,
      retry_jitter SMALLINT NOT NULL DEFAULT 0,
      failure_message TEXT,
      retention_mode VARCHAR(32) NOT NULL DEFAULT 'KEEP_FOREVER',
      retention_ttl_ms BIGINT,
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
      every_ms BIGINT,
      timezone TEXT,
      data TEXT,
      priority INTEGER,
      retry_max_attempts INTEGER,
      retry_delay_ms BIGINT,
      next_run_at BIGINT,
      last_run_at BIGINT,
      enabled SMALLINT NOT NULL DEFAULT 1,
      start_at BIGINT,
      end_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
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

function v2(t: PhysicalName): string[] {
  return [`ALTER TABLE ${t(TableName.SCHEDULE)} ADD COLUMN idempotency_key TEXT`];
}

export const MYSQL_MIGRATIONS: FlavourMigration[] = [
  { version: 1, checksum: 'v1-base-schema', statements: v1 },
  { version: 2, checksum: 'v2-schedule-idempotency-key', statements: v2 },
];
