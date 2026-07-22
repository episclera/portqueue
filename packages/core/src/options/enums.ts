/** Retry backoff strategies (build_plan/06.4). */
export enum BackoffStrategy {
  FIXED = 'FIXED',
  EXPONENTIAL = 'EXPONENTIAL',
}

/** Manual-retry modes for a failed job/workflow (build_plan/06.8.1). */
export enum RetryMode {
  /** Re-arm the failed step's own job with its persisted data (default). */
  FROM_FAILED_STEP = 'FROM_FAILED_STEP',
  /** Begin a fresh run from the entry step under a new workflow id. */
  FROM_START = 'FROM_START',
}

/** How a queue is paused (build_plan/05.3). */
export enum PauseMode {
  /** Workers stop claiming/running jobs, but the queue still accepts new adds. */
  PROCESSING = 'PROCESSING',
  /** Also refuse new jobs (drain/incident control). */
  ALL = 'ALL',
}

/** Why an add was deduplicated (build_plan/05.3 / 06.6). */
export enum DeduplicationReason {
  IDEMPOTENCY = 'IDEMPOTENCY',
  SINGLETON = 'SINGLETON',
}

/** Retention policy modes (build_plan/06.9). */
export enum RetentionMode {
  KEEP_FOREVER = 'KEEP_FOREVER',
  DELETE_AFTER = 'DELETE_AFTER',
}

/** Auto-migration behavior on init (build_plan/04.7). */
export enum MigrationMode {
  AUTO = 'AUTO',
  MANUAL = 'MANUAL',
  VALIDATE_ONLY = 'VALIDATE_ONLY',
}

/** Database engines a driver can advertise (build_plan/03.2). */
export enum DatabaseEngine {
  POSTGRES = 'POSTGRES',
  PGLITE = 'PGLITE',
  SQLITE = 'SQLITE',
  ORACLE = 'ORACLE',
  CUSTOM = 'CUSTOM',
}

/** How the running process is classified for job attribution (build_plan/07.3). */
export enum InstanceType {
  CONTAINER = 'CONTAINER',
  BARE_METAL = 'BARE_METAL',
  UNKNOWN = 'UNKNOWN',
}
