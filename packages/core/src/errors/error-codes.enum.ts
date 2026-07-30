/**
 * Typed, importable error codes. No magic strings.
 *
 * Every code here is one an error class actually carries and something actually throws. A code that
 * nothing can produce is a promise to the reader that the library does not keep, so the
 * never-thrown placeholders (`ALREADY_STARTED`, `ALREADY_STOPPED`, `IDEMPOTENCY_CONFLICT`,
 * `SINGLETON_CONFLICT`, `MIGRATION_CHECKSUM_MISMATCH`) are gone: `init()` is idempotent, dedup
 * returns a result rather than raising, and migrations are identified by version alone.
 *
 * There is no `JOB_NOT_FOUND` either. Every by-id operation reports a missing job the way its return
 * type already says it does — `getJob` gives `null`, `removeJob`/`cancelJob` give `false`,
 * `retryJob` gives `null` — which is both the nicer API and the one that lets a batch skip a stale id
 * instead of failing on it.
 */
export enum PortQueueErrorCode {
  NOT_STARTED = 'NOT_STARTED',
  INVALID_OPTIONS = 'INVALID_OPTIONS',
  UNSUPPORTED_CAPABILITY = 'UNSUPPORTED_CAPABILITY',
  SCHEMA_VERSION_MISMATCH = 'SCHEMA_VERSION_MISMATCH',
  MIGRATION_FAILED = 'MIGRATION_FAILED',
  DRIVER_CONNECTION_ERROR = 'DRIVER_CONNECTION_ERROR',
  DRIVER_QUERY_ERROR = 'DRIVER_QUERY_ERROR',
  QUEUE_NOT_FOUND = 'QUEUE_NOT_FOUND',
  QUEUE_PAUSED = 'QUEUE_PAUSED',
  QUEUE_IN_USE = 'QUEUE_IN_USE',
  INSTANCE_ACTIVE = 'INSTANCE_ACTIVE',
  SHUTDOWN_TIMEOUT = 'SHUTDOWN_TIMEOUT',
  MISSING_PEER_DEPENDENCY = 'MISSING_PEER_DEPENDENCY',
}
