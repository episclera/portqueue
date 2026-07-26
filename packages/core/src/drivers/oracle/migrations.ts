import { TableName } from '../table-names';
import type { FlavourMigration, PhysicalName } from '../shared/migration';
// NOTE: column names here are intentionally raw string literals, NOT the `*Column` enums used
// by the drivers. A migration is a frozen record of a schema that has already been applied;
// renaming an enum member must never retroactively rewrite a past migration's DDL.

/**
 * Predefined Oracle DDL, version by version. Oracle has no `TEXT`/`BIGINT`/`SMALLINT` and (pre-23c)
 * no `CREATE TABLE IF NOT EXISTS`, so this flavour is authored from scratch rather than borrowed
 * from Postgres:
 *   - short strings → `VARCHAR2(4000)`, free-form payloads (`data`, `return_value`,
 *     `failure_message`) → `CLOB`;
 *   - integers → `NUMBER(p)` (`NUMBER(19)` bigint, `NUMBER(10)` int, `NUMBER(5)` smallint),
 *     floats → `BINARY_DOUBLE`;
 *   - idempotent creation is emulated with a PL/SQL block that swallows ORA-00955 (name already
 *     used) — see `createIfAbsent`.
 * Authored by hand for this engine; not generated at runtime.
 *
 * There is a single version so far — the base schema — but the array is the extension point: a
 * future change appends `{ version: 2, ... }` with its own statement builder rather than editing
 * `v1`, which is a frozen record of what has already been applied. An additive `ALTER TABLE … ADD
 * (col type)` needs the same PL/SQL treatment, swallowing ORA-01430 (column already exists), so
 * re-running it stays a no-op.
 */

/** Wrap a `CREATE TABLE` so re-running the migration is a no-op (emulates `IF NOT EXISTS`). */
function createIfAbsent(ddl: string): string {
  return `BEGIN
  EXECUTE IMMEDIATE '${ddl.replace(/'/g, "''")}';
EXCEPTION
  WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
END;`;
}

/** Version 1 — the full base schema. */
function v1(t: PhysicalName): string[] {
  return [
    createIfAbsent(
      `CREATE TABLE ${t(TableName.QUEUE)} (
        name VARCHAR2(4000) NOT NULL,
        processing_paused NUMBER(5) DEFAULT 0 NOT NULL,
        accepting_paused NUMBER(5) DEFAULT 0 NOT NULL,
        created_at NUMBER(19) NOT NULL,
        updated_at NUMBER(19) NOT NULL
      )`,
    ),
    createIfAbsent(
      `CREATE TABLE ${t(TableName.JOB)} (
        id VARCHAR2(4000) NOT NULL,
        queue_name VARCHAR2(4000) NOT NULL,
        status VARCHAR2(4000) NOT NULL,
        priority NUMBER(10) DEFAULT 0 NOT NULL,
        data CLOB,
        return_value CLOB,
        created_at NUMBER(19) NOT NULL,
        updated_at NUMBER(19) NOT NULL,
        start_after NUMBER(19) NOT NULL,
        expire_at NUMBER(19),
        started_at NUMBER(19),
        completed_at NUMBER(19),
        failed_at NUMBER(19),
        retried_at NUMBER(19),
        stalled_at NUMBER(19),
        cancelled_at NUMBER(19),
        expired_at NUMBER(19),
        locked_until NUMBER(19),
        preferred_instance_key_pattern VARCHAR2(4000),
        processed_on_instance_key VARCHAR2(4000),
        retry_attempt NUMBER(10) DEFAULT 0 NOT NULL,
        retry_max_attempts NUMBER(10) DEFAULT 1 NOT NULL,
        retry_delay_seconds NUMBER(19) DEFAULT 0 NOT NULL,
        retry_backoff VARCHAR2(32) DEFAULT 'FIXED' NOT NULL,
        retry_backoff_factor BINARY_DOUBLE,
        retry_max_delay_seconds NUMBER(19),
        retry_jitter NUMBER(5) DEFAULT 0 NOT NULL,
        failure_message CLOB,
        retention_mode VARCHAR2(32) DEFAULT 'KEEP_FOREVER' NOT NULL,
        retention_ttl_seconds NUMBER(19),
        idempotency_key VARCHAR2(4000),
        schedule_id VARCHAR2(4000),
        singleton_key VARCHAR2(4000)
      )`,
    ),
    createIfAbsent(
      `CREATE TABLE ${t(TableName.SCHEDULE)} (
        id VARCHAR2(4000) NOT NULL,
        queue_name VARCHAR2(4000) NOT NULL,
        cron VARCHAR2(4000),
        every_seconds NUMBER(19),
        timezone VARCHAR2(4000),
        data CLOB,
        job_options CLOB,
        priority NUMBER(10),
        retry_max_attempts NUMBER(10),
        retry_delay_seconds NUMBER(19),
        next_run_at NUMBER(19),
        last_run_at NUMBER(19),
        enabled NUMBER(5) DEFAULT 1 NOT NULL,
        start_at NUMBER(19),
        end_at NUMBER(19),
        created_at NUMBER(19) NOT NULL,
        updated_at NUMBER(19) NOT NULL,
        idempotency_key VARCHAR2(4000)
      )`,
    ),
    createIfAbsent(
      `CREATE TABLE ${t(TableName.INSTANCE)} (
        instance_key VARCHAR2(4000) NOT NULL,
        processing_paused NUMBER(5) DEFAULT 0 NOT NULL,
        created_at NUMBER(19) NOT NULL,
        updated_at NUMBER(19) NOT NULL,
        last_seen_at NUMBER(19) NOT NULL,
        cpu_percent BINARY_DOUBLE,
        memory_percent BINARY_DOUBLE
      )`,
    ),
    createIfAbsent(
      `CREATE TABLE ${t(TableName.MIGRATION)} (
        version NUMBER(10) NOT NULL,
        applied_at NUMBER(19) NOT NULL,
        checksum VARCHAR2(4000) NOT NULL,
        created_at NUMBER(19) NOT NULL,
        updated_at NUMBER(19) NOT NULL
      )`,
    ),
  ];
}

export const ORACLE_MIGRATIONS: FlavourMigration[] = [
  { version: 1, checksum: 'v1-base-schema', statements: v1 },
];
