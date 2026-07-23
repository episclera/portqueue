import { TableName } from '../table-names';
import type { FlavourMigration, PhysicalName } from '../shared/migration';
// NOTE: column names here are intentionally raw string literals, NOT the `*Column` enums used
// by the drivers. A migration is a frozen record of a schema that has already been applied;
// renaming an enum member must never retroactively rewrite a past migration's DDL.


/**
 * Predefined Citus DDL, version by version. Citus extends Postgres, so the column types match the
 * Postgres flavour — but this flavour is authored in full (not re-exported) because it does one
 * thing Postgres never does: it distributes each table on its shard key right after creating it.
 * Jobs and schedules co-locate with their queue on `queue_name`; instances shard on `instance_key`;
 * the tiny migration ledger is a replicated reference table so every worker reads the version
 * locally. Authored by hand for this engine; not generated at runtime.
 */

/** Version 1 — the full base schema, then the shard-key declarations. */
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
      retry_backoff TEXT NOT NULL DEFAULT 'FIXED',
      retry_backoff_factor REAL,
      retry_max_delay_ms BIGINT,
      retry_jitter SMALLINT NOT NULL DEFAULT 0,
      failure_message TEXT,
      retention_mode TEXT NOT NULL DEFAULT 'KEEP_FOREVER',
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
    // Shard declarations — the Citus-specific step. Distribute on the queue name so a queue's jobs
    // and schedules land on the same shard and claim/scan stays node-local.
    `SELECT create_distributed_table('${t(TableName.QUEUE)}', 'name')`,
    `SELECT create_distributed_table('${t(TableName.JOB)}', 'queue_name', colocate_with => '${t(TableName.QUEUE)}')`,
    `SELECT create_distributed_table('${t(TableName.SCHEDULE)}', 'queue_name', colocate_with => '${t(TableName.QUEUE)}')`,
    `SELECT create_distributed_table('${t(TableName.INSTANCE)}', 'instance_key')`,
    `SELECT create_reference_table('${t(TableName.MIGRATION)}')`,
  ];
}

/** Version 2 — add the schedule cross-table dedup token (propagates to every shard). */
function v2(t: PhysicalName): string[] {
  return [`ALTER TABLE ${t(TableName.SCHEDULE)} ADD COLUMN idempotency_key TEXT`];
}

export const CITUS_MIGRATIONS: FlavourMigration[] = [
  { version: 1, checksum: 'v1-base-schema', statements: v1 },
  { version: 2, checksum: 'v2-schedule-idempotency-key', statements: v2 },
];
