/**
 * Client-safe mirror of the core enums the SPA needs as *values* (no magic
 * strings). Importing the `@portqueue/core` barrel into the browser bundle would pull in its
 * node-only services (fs/os/crypto), so the client re-declares the small set of string enums
 * it uses. These MUST stay byte-identical to `@portqueue/core`'s enum values; they are the
 * same string-literal contract crossing the JSON boundary.
 *
 * Types (JobSnapshot etc.) are imported type-only from '@portqueue/core' elsewhere and erased
 * at build time, so they never drag runtime code in — only value imports do.
 */

/** Mirror of core `JobStatus`. */
export enum JobStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  RETRY = 'RETRY',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

/** Mirror of core `PauseMode`. */
export enum PauseMode {
  PROCESSING = 'PROCESSING',
  ALL = 'ALL',
}

/** Mirror of core `RetryMode`. */
export enum RetryMode {
  FROM_FAILED_STEP = 'FROM_FAILED_STEP',
  FROM_START = 'FROM_START',
}
