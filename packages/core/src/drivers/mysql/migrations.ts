import { TableName } from '../table-names';
import type { FlavourMigration, MigrationNames } from '../shared/migration';
// NOTE: column names and enum values here are intentionally raw string literals, NOT the
// `*Column`/`JobStatus`/`RetentionMode` enums the drivers use. A migration is a frozen record of a
// schema that has already been applied; renaming an enum member must never retroactively rewrite a
// past migration's DDL.

/**
 * Predefined MySQL DDL, authored in full for this engine. Four engine-specific facts shape it:
 *
 * - **MySQL cannot index a `TEXT` column** without a prefix length, and forbids a `DEFAULT` on one.
 *   Every column that is indexed, keyed or defaulted is therefore `VARCHAR(n)`; only the free-form
 *   payloads (`data`, `return_value`, `failure_message`, `job_options`,
 *   `preferred_instance_key_pattern`) stay `TEXT`.
 * - **There is no `CREATE INDEX IF NOT EXISTS`.** Indexes are declared inline as `KEY` clauses
 *   inside `CREATE TABLE IF NOT EXISTS`, which makes re-running the migration a no-op without any
 *   existence probing.
 * - **There are no partial indexes**, so the Postgres flavour's `WHERE … IS NOT NULL` predicates are
 *   dropped; the index simply covers the NULL rows too.
 * - **A schema is a database**, so `CREATE SCHEMA IF NOT EXISTS` creates one.
 *
 * `REAL` is MySQL's synonym for `DOUBLE`; `BIGINT`/`INTEGER`/`SMALLINT` are native. Authored by hand;
 * not generated at runtime. There is a single version so far — the base schema — but the array is
 * the extension point: a future change appends `{ version: 2, ... }` with its own statement builder
 * rather than editing `v1`, which is a frozen record of what has already been applied.
 */

/** Version 1 — the full base schema, its keys and its indexes. */
function v1(names: MigrationNames): string[] {
  const t = names.name;
  const idx = names.derived;
  const statements: string[] = [];

  if (names.schema) statements.push(`CREATE SCHEMA IF NOT EXISTS ${names.schema}`);

  statements.push(
    `CREATE TABLE IF NOT EXISTS ${t(TableName.QUEUE)} (
      name VARCHAR(255) NOT NULL,
      processing_paused SMALLINT NOT NULL DEFAULT 0,
      accepting_paused SMALLINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (name)
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.JOB)} (
      id VARCHAR(255) NOT NULL,
      queue_name VARCHAR(255) NOT NULL,
      status VARCHAR(32) NOT NULL,
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
      processed_on_instance_key VARCHAR(255),
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
      retention_statuses VARCHAR(255),
      idempotency_key VARCHAR(255),
      schedule_id VARCHAR(255),
      singleton_key VARCHAR(255),
      PRIMARY KEY (id),
      KEY ${idx(TableName.JOB, 'claim_idx')} (queue_name, status, priority DESC, start_after ASC),
      KEY ${idx(TableName.JOB, 'stalled_idx')} (status, locked_until),
      KEY ${idx(TableName.JOB, 'expiry_idx')} (status, expire_at),
      KEY ${idx(TableName.JOB, 'retention_idx')} (retention_mode, status, retention_ttl_seconds),
      KEY ${idx(TableName.JOB, 'idempotency_idx')} (queue_name, idempotency_key),
      KEY ${idx(TableName.JOB, 'singleton_idx')} (queue_name, singleton_key, status),
      KEY ${idx(TableName.JOB, 'created_idx')} (created_at DESC),
      KEY ${idx(TableName.JOB, 'schedule_idx')} (schedule_id),
      KEY ${idx(TableName.JOB, 'instance_idx')} (processed_on_instance_key, status)
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.SCHEDULE)} (
      id VARCHAR(255) NOT NULL,
      queue_name VARCHAR(255) NOT NULL,
      cron VARCHAR(255),
      every_seconds BIGINT,
      timezone VARCHAR(255),
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
      idempotency_key VARCHAR(255),
      PRIMARY KEY (id),
      KEY ${idx(TableName.SCHEDULE, 'due_idx')} (enabled, next_run_at),
      KEY ${idx(TableName.SCHEDULE, 'queue_idx')} (queue_name, created_at),
      KEY ${idx(TableName.SCHEDULE, 'idempotency_idx')} (queue_name, idempotency_key)
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.INSTANCE)} (
      instance_key VARCHAR(255) NOT NULL,
      processing_paused SMALLINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL,
      cpu_percent DOUBLE,
      memory_percent DOUBLE,
      PRIMARY KEY (instance_key),
      KEY ${idx(TableName.INSTANCE, 'seen_idx')} (last_seen_at)
    )`,
    `CREATE TABLE IF NOT EXISTS ${t(TableName.MIGRATION)} (
      version INTEGER NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (version)
    )`,
  );

  return statements;
}

export const MYSQL_MIGRATIONS: FlavourMigration[] = [{ version: 1, statements: v1 }];
