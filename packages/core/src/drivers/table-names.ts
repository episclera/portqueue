import { DEFAULT_MAX_IDENTIFIER_LEN, DEFAULT_TABLE_PREFIX } from '../constants';
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
  /**
   * A fresh token written by every claim, and the fence every completion is guarded on.
   *
   * `locked_until` alone cannot say *whose* claim a row is under: a lock that lapses is reclaimed,
   * the row is claimed again, and it is `ACTIVE` with a future deadline once more — so a handler
   * from the first run that ignored its abort signal could still write its outcome over the second
   * run's. A token identifies the claim itself, so a stale completion matches nothing and is refused.
   */
  LOCK_TOKEN = 'lock_token',
  PREFERRED_INSTANCE_KEY_PATTERN = 'preferred_instance_key_pattern',
  PROCESSED_ON_INSTANCE_KEY = 'processed_on_instance_key',
  RETRY_ATTEMPT = 'retry_attempt',
  RETRY_MAX_ATTEMPTS = 'retry_max_attempts',
  RETRY_DELAY_SECONDS = 'retry_delay_seconds',
  RETRY_BACKOFF = 'retry_backoff',
  RETRY_BACKOFF_FACTOR = 'retry_backoff_factor',
  RETRY_MAX_DELAY_SECONDS = 'retry_max_delay_seconds',
  RETRY_JITTER = 'retry_jitter',
  FAILURE_MESSAGE = 'failure_message',
  /**
   * How long after finishing this job may be deleted, in whole seconds, or NULL to keep it forever.
   * NULL is the whole of "no retention policy" — there is no separate mode column to disagree with
   * it.
   */
  RETENTION_TTL_SECONDS = 'retention_ttl_seconds',
  /**
   * The finished statuses this job's retention policy may delete, as a comma-separated token list,
   * or NULL for "every finished status". Frozen onto the row like every other retention field, so a
   * policy change never retroactively re-scopes jobs that are already queued.
   */
  RETENTION_STATUSES = 'retention_statuses',
  IDEMPOTENCY_KEY = 'idempotency_key',
  SCHEDULE_ID = 'schedule_id',
  SINGLETON_KEY = 'singleton_key',
}

export enum ScheduleColumn {
  ID = 'id',
  QUEUE_NAME = 'queue_name',
  CRON = 'cron',
  EVERY_SECONDS = 'every_seconds',
  TIMEZONE = 'timezone',
  DATA = 'data',
  PRIORITY = 'priority',
  RETRY_MAX_ATTEMPTS = 'retry_max_attempts',
  RETRY_DELAY_SECONDS = 'retry_delay_seconds',
  NEXT_RUN_AT = 'next_run_at',
  LAST_RUN_AT = 'last_run_at',
  ENABLED = 'enabled',
  IDEMPOTENCY_KEY = 'idempotency_key',
  JOB_OPTIONS = 'job_options',
  CREATED_AT = 'created_at',
  UPDATED_AT = 'updated_at',
}

export enum InstanceColumn {
  INSTANCE_KEY = 'instance_key',
  PROCESSING_PAUSED = 'processing_paused',
  CREATED_AT = 'created_at',
  UPDATED_AT = 'updated_at',
  LAST_SEEN_AT = 'last_seen_at',
  CPU_PERCENT = 'cpu_percent',
  MEMORY_PERCENT = 'memory_percent',
}

export enum MigrationColumn {
  VERSION = 'version',
  CREATED_AT = 'created_at',
  UPDATED_AT = 'updated_at',
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate a user-influenced identifier (schema / tablePrefix) against a strict
 * allowlist. Fails fast with a clear error; never reaches SQL raw.
 */
export function validateIdentifier(
  kind: string,
  value: string,
  maxLen = DEFAULT_MAX_IDENTIFIER_LEN,
): string {
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
 * Resolves prefixed and (where the engine has them) schema-qualified object names once.
 *
 * Two accessors, because the two forms are not interchangeable:
 *
 * - {@link qualified} is what every query site uses. With `schema: 'jobs'` it returns
 *   `jobs.pq_job`, so the tables really are created in and read from that schema.
 * - {@link bare} is the unqualified `pq_job`, for the places a schema prefix is wrong: naming a
 *   *derived* object (an index, a constraint) that an engine files alongside its table, and
 *   engine metadata lookups that take a schema and a table name as separate values.
 */
export class TableNames {
  readonly prefix: string;
  readonly schema?: string;

  constructor(options: { tablePrefix?: string; schema?: string; maxIdentifierLen?: number }) {
    this.prefix = validateIdentifier(
      'tablePrefix',
      options.tablePrefix ?? DEFAULT_TABLE_PREFIX,
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

  /**
   * The name a query must use: schema-qualified when a `schema` was configured, bare otherwise.
   * Both halves are allowlist-validated identifiers, so nothing here can be injected.
   */
  qualified(table: TableName): string {
    const name = this.bare(table);
    return this.schema ? `${this.schema}.${name}` : name;
  }

  /**
   * The name for an object an engine files *inside* the table's own schema — an index or a
   * constraint. `<prefix><table>_<suffix>`, unqualified, because qualifying it would name the
   * schema twice (`CREATE INDEX jobs.x ON jobs.pq_job` is an error on Postgres).
   */
  derived(table: TableName, suffix: string): string {
    return `${this.bare(table)}_${suffix}`;
  }
}
