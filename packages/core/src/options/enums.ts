/** Retry backoff strategies. */
export enum BackoffStrategy {
  FIXED = 'FIXED',
  EXPONENTIAL = 'EXPONENTIAL',
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
