import { TableName, type TableNames } from './table-names.js';

/**
 * Engine-neutral DDL (build_plan/04). For portability and simplicity across the
 * PG-family and SQLite we store timestamps/durations as BIGINT epoch-ms, JSON as TEXT,
 * and booleans as small integers 0/1 on every engine (a justified physical deviation
 * recorded in build_plan/20 — the logical four-table model and public API are identical).
 * BIGINT is required so epoch-ms values don't overflow Postgres' 32-bit INTEGER; SQLite
 * treats BIGINT as its native 64-bit INTEGER via type affinity. All constraint/index
 * names are explicit per the naming convention (build_plan/04.2).
 */
export function buildSchemaStatements(t: TableNames): string[] {
  const job = t.bare(TableName.JOB);
  const queue = t.bare(TableName.QUEUE);
  const schedule = t.bare(TableName.SCHEDULE);
  const migration = t.bare(TableName.MIGRATION_STATE);
  const p = t.prefix;

  return [
    `CREATE TABLE IF NOT EXISTS ${queue} (
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      processing_paused SMALLINT NOT NULL DEFAULT 0,
      accepting_paused SMALLINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      CONSTRAINT pk_${p}queue PRIMARY KEY (id),
      CONSTRAINT uq_${p}queue_name UNIQUE (name)
    )`,

    `CREATE TABLE IF NOT EXISTS ${job} (
      id TEXT NOT NULL,
      queue_id TEXT NOT NULL,
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
      run_on_instance_id TEXT,
      run_on_instance_type TEXT,
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
      workflow_step_key TEXT,
      CONSTRAINT pk_${p}job PRIMARY KEY (id),
      CONSTRAINT ck_${p}job_workflow CHECK (
        (workflow_id IS NULL AND workflow_step_key IS NULL) OR
        (workflow_id IS NOT NULL AND workflow_step_key IS NOT NULL)
      )
    )`,

    `CREATE INDEX IF NOT EXISTS ix_${p}job_claim ON ${job} (queue_id, status, priority DESC, start_after)`,
    `CREATE INDEX IF NOT EXISTS ix_${p}job_locked_until ON ${job} (status, locked_until)`,
    `CREATE INDEX IF NOT EXISTS ix_${p}job_schedule ON ${job} (schedule_id)`,
    `CREATE INDEX IF NOT EXISTS ix_${p}job_workflow ON ${job} (workflow_id, created_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_${p}job_queue_idempotency ON ${job} (queue_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_${p}job_singleton ON ${job} (queue_id, singleton_key) WHERE singleton_key IS NOT NULL AND status IN ('PENDING','ACTIVE','RETRY')`,

    `CREATE TABLE IF NOT EXISTS ${schedule} (
      id TEXT NOT NULL,
      key TEXT NOT NULL,
      queue_id TEXT NOT NULL,
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
      updated_at BIGINT NOT NULL,
      CONSTRAINT pk_${p}schedule PRIMARY KEY (id),
      CONSTRAINT uq_${p}schedule_queue_key UNIQUE (queue_id, key),
      CONSTRAINT ck_${p}schedule_mode CHECK (
        (cron IS NOT NULL AND every_ms IS NULL) OR (cron IS NULL AND every_ms IS NOT NULL)
      )
    )`,
    `CREATE INDEX IF NOT EXISTS ix_${p}schedule_due ON ${schedule} (enabled, next_run_at)`,

    `CREATE TABLE IF NOT EXISTS ${migration} (
      version INTEGER NOT NULL,
      applied_at BIGINT NOT NULL,
      checksum TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      CONSTRAINT pk_${p}migration PRIMARY KEY (version)
    )`,

    // Cluster-wide rate-limit usage counter (build_plan/07.4).
    `CREATE TABLE IF NOT EXISTS ${p}rate_usage (
      queue_id TEXT NOT NULL,
      window_start BIGINT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT pk_${p}rate_usage PRIMARY KEY (queue_id)
    )`,
  ];
}

/** The current schema version this build ships (build_plan/04.7). */
export const CURRENT_SCHEMA_VERSION = 1;
