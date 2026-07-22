/**
 * Job lifecycle states. Exported so consumers never use magic strings.
 * `STALLED` is a *derived* status (an ACTIVE row past its lock deadline) — never stored.
 */
export enum JobStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  RETRY = 'RETRY',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

/** Derived (computed at read time, never persisted). */
export const STALLED = 'STALLED' as const;

/** The set of terminal/finished statuses retention may act on. */
export const FINISHED_STATUSES: readonly JobStatus[] = [
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
  JobStatus.EXPIRED,
];

/** Statuses in which a job holds a claim / occupies an "active-ish" slot for singleton uniqueness. */
export const ACTIVE_STATUSES: readonly JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.ACTIVE,
  JobStatus.RETRY,
];
