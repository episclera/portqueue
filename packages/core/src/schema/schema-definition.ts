import { TableName, type TableNames } from './table-names.js';

/**
 * Engine-neutral DDL. For portability and simplicity across the
 * PG-family and SQLite we store timestamps/durations as BIGINT epoch-ms, JSON as TEXT,
 * and booleans as small integers 0/1 on every engine (a justified physical deviation
 * recorded in — the logical model and public API are identical).
 * BIGINT is required so epoch-ms values don't overflow Postgres' 32-bit INTEGER; SQLite
 * treats BIGINT as its native 64-bit INTEGER via type affinity.
 *
 * **Sharded-DB portability.** These tables carry NO primary keys, unique
 * constraints, check constraints, foreign keys, or secondary indexes. Distributed / sharded
 * engines frequently reject or silently ignore them, so every invariant that a constraint or
 * index would enforce (name uniqueness, idempotency/singleton dedup, the workflow-pair rule)
 * is instead enforced in the tool. Relationships link by **name or key**, never by a numeric
 * id — a job carries its `queue_name` directly, a schedule its `queue_name`, an instance its
 * `instance_key`. This keeps every table independently shardable with no cross-table joins.
 */
export function buildSchemaStatements(t: TableNames): string[] {
  const job = t.bare(TableName.JOB);
  const queue = t.bare(TableName.QUEUE);
  const schedule = t.bare(TableName.SCHEDULE);
  const instance = t.bare(TableName.INSTANCE);
  const migration = t.bare(TableName.MIGRATION);

  return [
    // Queues are identified by name (no surrogate id). Uniqueness is tool-managed.
    `CREATE TABLE IF NOT EXISTS ${queue} (
      name TEXT NOT NULL,
      processing_paused SMALLINT NOT NULL DEFAULT 0,
      accepting_paused SMALLINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`,

    // A job links to its queue by name and carries instance-affinity keys directly.
    `CREATE TABLE IF NOT EXISTS ${job} (
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
      preferred_instance_key TEXT,
      preferred_instance_key_pattern TEXT,
      fallback_instance_key TEXT,
      fallback_instance_key_pattern TEXT,
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

    // A schedule's identity is (queue_name, cron+timezone) or (queue_name, every_ms) — no
    // separate key column; re-adding the same recurrence updates the same row.
    `CREATE TABLE IF NOT EXISTS ${schedule} (
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

    // Instance liveness + per-instance pause. Identified by instance_key;
    // `last_seen_at` is bumped by each instance's heartbeat and drives claim-time liveness.
    `CREATE TABLE IF NOT EXISTS ${instance} (
      instance_key TEXT NOT NULL,
      processing_paused SMALLINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS ${migration} (
      version INTEGER NOT NULL,
      applied_at BIGINT NOT NULL,
      checksum TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`,
  ];
}

/** The current schema version this build ships. */
export const CURRENT_SCHEMA_VERSION = 1;
