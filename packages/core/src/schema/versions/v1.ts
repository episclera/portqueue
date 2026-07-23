import { TableName } from '../table-names.js';
import { ColumnType, type ColumnDef, type SchemaDef, type TableDef } from '../model.js';

/**
 * Schema **version 1** — the base schema, as data. This is the source of truth; the concrete DDL
 * for each engine lives under `migrations/<flavour>/`. Never mutate a shipped version — add a new
 * one and its per-flavour migration statements.
 */

const text = (name: string, o: Partial<ColumnDef> = {}): ColumnDef => ({ name, type: ColumnType.TEXT, ...o });
const int = (name: string, o: Partial<ColumnDef> = {}): ColumnDef => ({ name, type: ColumnType.INTEGER, ...o });
const big = (name: string, o: Partial<ColumnDef> = {}): ColumnDef => ({ name, type: ColumnType.BIGINT, ...o });
const small = (name: string, o: Partial<ColumnDef> = {}): ColumnDef => ({ name, type: ColumnType.SMALLINT, ...o });
const real = (name: string, o: Partial<ColumnDef> = {}): ColumnDef => ({ name, type: ColumnType.REAL, ...o });

export const queue: TableDef = {
  name: TableName.QUEUE,
  columns: [
    text('name', { notNull: true }),
    small('processing_paused', { notNull: true, default: 0 }),
    small('accepting_paused', { notNull: true, default: 0 }),
    big('created_at', { notNull: true }),
    big('updated_at', { notNull: true }),
  ],
};

export const job: TableDef = {
  name: TableName.JOB,
  columns: [
    text('id', { notNull: true }),
    text('queue_name', { notNull: true }),
    text('status', { notNull: true }),
    int('priority', { notNull: true, default: 0 }),
    text('data'),
    text('return_value'),
    text('metadata'),
    big('created_at', { notNull: true }),
    big('updated_at', { notNull: true }),
    big('start_after', { notNull: true }),
    big('expire_at'),
    big('started_at'),
    big('completed_at'),
    big('failed_at'),
    big('retried_at'),
    big('stalled_at'),
    big('cancelled_at'),
    big('expired_at'),
    big('locked_until'),
    text('locked_by_instance_id'),
    text('preferred_instance_key_pattern'),
    text('processed_on_instance_key'),
    int('retry_attempt', { notNull: true, default: 0 }),
    int('retry_max_attempts', { notNull: true, default: 1 }),
    big('retry_delay_ms', { notNull: true, default: 0 }),
    text('retry_backoff', { notNull: true, default: "'FIXED'" }),
    real('retry_backoff_factor'),
    big('retry_max_delay_ms'),
    small('retry_jitter', { notNull: true, default: 0 }),
    text('failure_message'),
    text('retention_mode', { notNull: true, default: "'KEEP_FOREVER'" }),
    big('retention_ttl_ms'),
    text('idempotency_key'),
    text('schedule_id'),
    text('singleton_key'),
    text('workflow_id'),
    text('workflow_step_key'),
  ],
};

export const scheduleV1: TableDef = {
  name: TableName.SCHEDULE,
  columns: [
    text('id', { notNull: true }),
    text('queue_name', { notNull: true }),
    text('cron'),
    big('every_ms'),
    text('timezone'),
    text('data'),
    int('priority'),
    int('retry_max_attempts'),
    big('retry_delay_ms'),
    big('next_run_at'),
    big('last_run_at'),
    small('enabled', { notNull: true, default: 1 }),
    big('start_at'),
    big('end_at'),
    big('created_at', { notNull: true }),
    big('updated_at', { notNull: true }),
  ],
};

export const instance: TableDef = {
  name: TableName.INSTANCE,
  columns: [
    text('instance_key', { notNull: true }),
    small('processing_paused', { notNull: true, default: 0 }),
    big('created_at', { notNull: true }),
    big('updated_at', { notNull: true }),
    big('last_seen_at', { notNull: true }),
  ],
};

export const migration: TableDef = {
  name: TableName.MIGRATION,
  columns: [
    int('version', { notNull: true }),
    big('applied_at', { notNull: true }),
    text('checksum', { notNull: true }),
    big('created_at', { notNull: true }),
    big('updated_at', { notNull: true }),
  ],
};

export const V1: SchemaDef = {
  version: 1,
  checksum: 'v1-base-schema',
  tables: [queue, job, scheduleV1, instance, migration],
};
