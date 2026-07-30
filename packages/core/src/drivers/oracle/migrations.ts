import { TableName } from '../table-names';
import type { FlavourMigration, MigrationNames } from '../shared/migration';
// NOTE: column names and enum values here are intentionally raw string literals, NOT the
// `*Column`/`JobStatus`/`RetentionMode` enums the drivers use. A migration is a frozen record of a
// schema that has already been applied; renaming an enum member must never retroactively rewrite a
// past migration's DDL.

/**
 * Predefined Oracle DDL, version by version. Oracle has no `TEXT`/`BIGINT`/`SMALLINT` and (pre-23c)
 * no `IF NOT EXISTS` on anything, so this flavour is authored from scratch rather than borrowed
 * from Postgres:
 *
 * - short strings → `VARCHAR2(255)`, free-form payloads (`data`, `return_value`, `failure_message`,
 *   `job_options`, `preferred_instance_key_pattern`) → `CLOB`;
 * - integers → `NUMBER(p)` (`NUMBER(19)` bigint, `NUMBER(10)` int, `NUMBER(5)` smallint),
 *   floats → `BINARY_DOUBLE`;
 * - idempotent creation is emulated with a PL/SQL block that swallows the "already exists" codes —
 *   ORA-00955 for a table or index name, ORA-02260/ORA-02261 for a duplicate key — see
 *   {@link createIfAbsent}.
 *
 * `VARCHAR2(255)` rather than the maximum `4000`: an Oracle B-tree key may not exceed roughly 40% of
 * the block size, and three 4000-byte columns in one composite index (the singleton dedup index)
 * would not fit an 8 KB block.
 *
 * Oracle has no partial indexes, and needs none here: it already leaves all-NULL entries out of a
 * B-tree, which is exactly what the Postgres flavour's `WHERE … IS NOT NULL` predicates buy.
 *
 * A `schema` on Oracle is a **user**, which cannot be conjured by a migration — the driver
 * qualifies every object name with it and the schema must already exist with the right grants.
 *
 * Authored by hand for this engine; not generated at runtime. There is a single version so far —
 * the base schema — but the array is the extension point: a future change appends
 * `{ version: 2, ... }` with its own statement builder rather than editing `v1`. An additive
 * `ALTER TABLE … ADD (col type)` needs the same PL/SQL treatment, swallowing ORA-01430 (column
 * already exists), so re-running it stays a no-op.
 */

/**
 * Wrap DDL so re-running the migration is a no-op (emulating `IF NOT EXISTS`). Swallows only the
 * "this object already exists" codes and re-raises everything else, so a genuine failure — a
 * missing tablespace, no privilege — still aborts the migration.
 */
function createIfAbsent(ddl: string): string {
  return `BEGIN
  EXECUTE IMMEDIATE '${ddl.replace(/'/g, "''")}';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE NOT IN (-955, -1408, -2260, -2261, -2275) THEN RAISE; END IF;
END;`;
}

/** Version 1 — the full base schema, its keys and its indexes. */
function v1(names: MigrationNames): string[] {
  const t = names.name;
  const idx = names.derived;
  return [
    createIfAbsent(
      `CREATE TABLE ${t(TableName.QUEUE)} (
        name VARCHAR2(255) NOT NULL,
        processing_paused NUMBER(5) DEFAULT 0 NOT NULL,
        accepting_paused NUMBER(5) DEFAULT 0 NOT NULL,
        created_at NUMBER(19) NOT NULL,
        updated_at NUMBER(19) NOT NULL,
        CONSTRAINT ${idx(TableName.QUEUE, 'pk')} PRIMARY KEY (name)
      )`,
    ),
    createIfAbsent(
      `CREATE TABLE ${t(TableName.JOB)} (
        id VARCHAR2(255) NOT NULL,
        queue_name VARCHAR2(255) NOT NULL,
        status VARCHAR2(32) NOT NULL,
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
        preferred_instance_key_pattern CLOB,
        processed_on_instance_key VARCHAR2(255),
        retry_attempt NUMBER(10) DEFAULT 0 NOT NULL,
        retry_max_attempts NUMBER(10) DEFAULT 1 NOT NULL,
        retry_delay_seconds NUMBER(19) DEFAULT 0 NOT NULL,
        retry_backoff VARCHAR2(32) DEFAULT ''FIXED'' NOT NULL,
        retry_backoff_factor BINARY_DOUBLE,
        retry_max_delay_seconds NUMBER(19),
        retry_jitter NUMBER(5) DEFAULT 0 NOT NULL,
        failure_message CLOB,
        retention_mode VARCHAR2(32) DEFAULT ''KEEP_FOREVER'' NOT NULL,
        retention_ttl_seconds NUMBER(19),
        retention_statuses VARCHAR2(255),
        idempotency_key VARCHAR2(255),
        schedule_id VARCHAR2(255),
        singleton_key VARCHAR2(255),
        CONSTRAINT ${idx(TableName.JOB, 'pk')} PRIMARY KEY (id)
      )`,
    ),
    createIfAbsent(
      `CREATE TABLE ${t(TableName.SCHEDULE)} (
        id VARCHAR2(255) NOT NULL,
        queue_name VARCHAR2(255) NOT NULL,
        cron VARCHAR2(255),
        every_seconds NUMBER(19),
        timezone VARCHAR2(255),
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
        idempotency_key VARCHAR2(255),
        CONSTRAINT ${idx(TableName.SCHEDULE, 'pk')} PRIMARY KEY (id)
      )`,
    ),
    createIfAbsent(
      `CREATE TABLE ${t(TableName.INSTANCE)} (
        instance_key VARCHAR2(255) NOT NULL,
        processing_paused NUMBER(5) DEFAULT 0 NOT NULL,
        created_at NUMBER(19) NOT NULL,
        updated_at NUMBER(19) NOT NULL,
        last_seen_at NUMBER(19) NOT NULL,
        cpu_percent BINARY_DOUBLE,
        memory_percent BINARY_DOUBLE,
        CONSTRAINT ${idx(TableName.INSTANCE, 'pk')} PRIMARY KEY (instance_key)
      )`,
    ),
    createIfAbsent(
      `CREATE TABLE ${t(TableName.MIGRATION)} (
        version NUMBER(10) NOT NULL,
        created_at NUMBER(19) NOT NULL,
        updated_at NUMBER(19) NOT NULL,
        CONSTRAINT ${idx(TableName.MIGRATION, 'pk')} PRIMARY KEY (version)
      )`,
    ),
    // The claim query, in its exact order.
    createIfAbsent(
      `CREATE INDEX ${idx(TableName.JOB, 'claim_idx')} ON ${t(TableName.JOB)} ` +
        `(queue_name, status, priority DESC, start_after ASC)`,
    ),
    // reclaimStalledJobs.
    createIfAbsent(
      `CREATE INDEX ${idx(TableName.JOB, 'stalled_idx')} ON ${t(TableName.JOB)} ` +
        `(status, locked_until)`,
    ),
    // expireDueJobs.
    createIfAbsent(
      `CREATE INDEX ${idx(TableName.JOB, 'expiry_idx')} ON ${t(TableName.JOB)} ` +
        `(status, expire_at)`,
    ),
    // The retention sweep.
    createIfAbsent(
      `CREATE INDEX ${idx(TableName.JOB, 'retention_idx')} ON ${t(TableName.JOB)} ` +
        `(retention_mode, status, retention_ttl_seconds)`,
    ),
    // Idempotency dedup (not unique — dedup is enforced in driver code on every engine).
    createIfAbsent(
      `CREATE INDEX ${idx(TableName.JOB, 'idem_idx')} ON ${t(TableName.JOB)} ` +
        `(queue_name, idempotency_key)`,
    ),
    // Singleton dedup.
    createIfAbsent(
      `CREATE INDEX ${idx(TableName.JOB, 'singleton_idx')} ON ${t(TableName.JOB)} ` +
        `(queue_name, singleton_key, status)`,
    ),
    // The newest-first job page.
    createIfAbsent(
      `CREATE INDEX ${idx(TableName.JOB, 'created_idx')} ON ${t(TableName.JOB)} (created_at DESC)`,
    ),
    // Jobs a schedule produced.
    createIfAbsent(
      `CREATE INDEX ${idx(TableName.JOB, 'schedule_idx')} ON ${t(TableName.JOB)} (schedule_id)`,
    ),
    // Per-instance attribution.
    createIfAbsent(
      `CREATE INDEX ${idx(TableName.JOB, 'instance_idx')} ON ${t(TableName.JOB)} ` +
        `(processed_on_instance_key, status)`,
    ),
    // getDueSchedules.
    createIfAbsent(
      `CREATE INDEX ${idx(TableName.SCHEDULE, 'due_idx')} ON ${t(TableName.SCHEDULE)} ` +
        `(enabled, next_run_at)`,
    ),
    // Schedules of one queue, in the list's own order.
    createIfAbsent(
      `CREATE INDEX ${idx(TableName.SCHEDULE, 'queue_idx')} ON ${t(TableName.SCHEDULE)} ` +
        `(queue_name, created_at)`,
    ),
    // The schedule dedup lookup.
    createIfAbsent(
      `CREATE INDEX ${idx(TableName.SCHEDULE, 'idem_idx')} ON ${t(TableName.SCHEDULE)} ` +
        `(queue_name, idempotency_key)`,
    ),
    // The instance list's liveness filter.
    createIfAbsent(
      `CREATE INDEX ${idx(TableName.INSTANCE, 'seen_idx')} ON ${t(TableName.INSTANCE)} ` +
        `(last_seen_at)`,
    ),
  ];
}

export const ORACLE_MIGRATIONS: FlavourMigration[] = [{ version: 1, statements: v1 }];
