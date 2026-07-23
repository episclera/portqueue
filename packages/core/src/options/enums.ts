/** Retry backoff strategies. */
export enum BackoffStrategy {
  FIXED = 'FIXED',
  EXPONENTIAL = 'EXPONENTIAL',
}

/** Manual-retry modes for a failed job/workflow. */
export enum RetryMode {
  /** Re-arm the failed step's own job with its persisted data (default). */
  FROM_FAILED_STEP = 'FROM_FAILED_STEP',
  /** Begin a fresh run from the entry step under a new workflow id. */
  FROM_START = 'FROM_START',
}

/** How a queue is paused. */
export enum PauseMode {
  /** Workers stop claiming/running jobs, but the queue still accepts new adds. */
  PROCESSING = 'PROCESSING',
  /** Also refuse new jobs (drain/incident control). */
  ALL = 'ALL',
}

/** Why an add was deduplicated. */
export enum DeduplicationReason {
  IDEMPOTENCY = 'IDEMPOTENCY',
  SINGLETON = 'SINGLETON',
}

/** Retention policy modes. */
export enum RetentionMode {
  KEEP_FOREVER = 'KEEP_FOREVER',
  DELETE_AFTER = 'DELETE_AFTER',
}

/** Auto-migration behavior on init. */
export enum MigrationMode {
  AUTO = 'AUTO',
  MANUAL = 'MANUAL',
  VALIDATE_ONLY = 'VALIDATE_ONLY',
}

/** Database engines a driver can advertise. */
export enum DatabaseEngine {
  POSTGRES = 'POSTGRES',
  PGLITE = 'PGLITE',
  SQLITE = 'SQLITE',
  ORACLE = 'ORACLE',
  MYSQL = 'MYSQL',
  CUSTOM = 'CUSTOM',
}
