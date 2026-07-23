import { InvalidOptionsError } from '../errors/errors';

/** Logical table names. Never a string literal at a query site. */
export enum TableName {
  QUEUE = 'queue',
  JOB = 'job',
  SCHEDULE = 'schedule',
  INSTANCE = 'instance',
  MIGRATION = 'migration',
}

/**
 * Physical column names, one enum per table. Drivers reference these instead of raw string
 * literals in queries so a rename is a single edit and a typo is a compile error. Exported for
 * driver authors and dashboard/reporting code that builds engine-agnostic column references.
 *
 * NOTE: migration DDL deliberately does NOT use these enums — see `drivers/<engine>/migrations.ts`.
 * A migration is a historical record of a schema that has already run; renaming an enum member must
 * never retroactively rewrite a past migration, so those files keep raw column-name strings.
 */
export enum QueueColumn {
  NAME = 'name',
  PROCESSING_PAUSED = 'processing_paused',
  ACCEPTING_PAUSED = 'accepting_paused',
  CREATED_AT = 'created_at',
  UPDATED_AT = 'updated_at',
}

export enum JobColumn {
  ID = 'id',
  QUEUE_NAME = 'queue_name',
  STATUS = 'status',
  PRIORITY = 'priority',
  DATA = 'data',
  RETURN_VALUE = 'return_value',
  METADATA = 'metadata',
  CREATED_AT = 'created_at',
  UPDATED_AT = 'updated_at',
  START_AFTER = 'start_after',
  EXPIRE_AT = 'expire_at',
  STARTED_AT = 'started_at',
  COMPLETED_AT = 'completed_at',
  FAILED_AT = 'failed_at',
  RETRIED_AT = 'retried_at',
  STALLED_AT = 'stalled_at',
  CANCELLED_AT = 'cancelled_at',
  EXPIRED_AT = 'expired_at',
  LOCKED_UNTIL = 'locked_until',
  LOCKED_BY_INSTANCE_ID = 'locked_by_instance_id',
  PREFERRED_INSTANCE_KEY_PATTERN = 'preferred_instance_key_pattern',
  PROCESSED_ON_INSTANCE_KEY = 'processed_on_instance_key',
  RETRY_ATTEMPT = 'retry_attempt',
  RETRY_MAX_ATTEMPTS = 'retry_max_attempts',
  RETRY_DELAY_MS = 'retry_delay_ms',
  RETRY_BACKOFF = 'retry_backoff',
  RETRY_BACKOFF_FACTOR = 'retry_backoff_factor',
  RETRY_MAX_DELAY_MS = 'retry_max_delay_ms',
  RETRY_JITTER = 'retry_jitter',
  FAILURE_MESSAGE = 'failure_message',
  RETENTION_MODE = 'retention_mode',
  RETENTION_TTL_MS = 'retention_ttl_ms',
  IDEMPOTENCY_KEY = 'idempotency_key',
  SCHEDULE_ID = 'schedule_id',
  SINGLETON_KEY = 'singleton_key',
  WORKFLOW_ID = 'workflow_id',
  WORKFLOW_STEP_KEY = 'workflow_step_key',
}

export enum ScheduleColumn {
  ID = 'id',
  QUEUE_NAME = 'queue_name',
  CRON = 'cron',
  EVERY_MS = 'every_ms',
  TIMEZONE = 'timezone',
  DATA = 'data',
  PRIORITY = 'priority',
  RETRY_MAX_ATTEMPTS = 'retry_max_attempts',
  RETRY_DELAY_MS = 'retry_delay_ms',
  NEXT_RUN_AT = 'next_run_at',
  LAST_RUN_AT = 'last_run_at',
  ENABLED = 'enabled',
  START_AT = 'start_at',
  END_AT = 'end_at',
  IDEMPOTENCY_KEY = 'idempotency_key',
  CREATED_AT = 'created_at',
  UPDATED_AT = 'updated_at',
}

export enum InstanceColumn {
  INSTANCE_KEY = 'instance_key',
  PROCESSING_PAUSED = 'processing_paused',
  CREATED_AT = 'created_at',
  UPDATED_AT = 'updated_at',
  LAST_SEEN_AT = 'last_seen_at',
}

export enum MigrationColumn {
  VERSION = 'version',
  APPLIED_AT = 'applied_at',
  CHECKSUM = 'checksum',
  CREATED_AT = 'created_at',
  UPDATED_AT = 'updated_at',
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate a user-influenced identifier (schema / tablePrefix) against a strict
 * allowlist. Fails fast with a clear error; never reaches SQL raw.
 */
export function validateIdentifier(kind: string, value: string, maxLen = 63): string {
  if (!IDENTIFIER_RE.test(value)) {
    throw new InvalidOptionsError(
      `Invalid ${kind} '${value}': must match ${IDENTIFIER_RE} (letters, digits, underscore; not starting with a digit).`,
    );
  }
  if (value.length > maxLen) {
    throw new InvalidOptionsError(
      `Invalid ${kind} '${value}': exceeds the ${maxLen}-character limit for this engine.`,
    );
  }
  return value;
}

/**
 * Resolves fully-qualified, prefixed, schema-qualified object names once.
 */
export class TableNames {
  readonly prefix: string;
  readonly schema?: string;

  constructor(options: { tablePrefix?: string; schema?: string; maxIdentifierLen?: number }) {
    this.prefix = validateIdentifier(
      'tablePrefix',
      options.tablePrefix ?? 'pq_',
      options.maxIdentifierLen,
    );
    if (options.schema !== undefined) {
      this.schema = validateIdentifier('schema', options.schema, options.maxIdentifierLen);
    }
  }

  /** The bare (unqualified) physical table name, e.g. `pq_job`. */
  bare(table: TableName): string {
    return `${this.prefix}${table}`;
  }
}
