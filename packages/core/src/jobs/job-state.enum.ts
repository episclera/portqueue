/**
 * Job lifecycle states. Exported so consumers never use magic strings.
 *
 * There is no `STALLED` state: an `ACTIVE` row past its lock deadline is *derived*, and it is
 * derived in exactly one place — {@link import('./snapshot').toSnapshot} sets `JobSnapshot.stalled`.
 * A second spelling of the same idea (an exported `'STALLED'` constant nothing compared against) is
 * a state consumers could branch on and never see.
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

/**
 * The terminal statuses retention may act on, and the default scope of a retention policy that
 * names none.
 */
export const FINISHED_STATUSES: readonly JobStatus[] = [
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
  JobStatus.EXPIRED,
];

/**
 * Statuses in which a job holds a claim / occupies an "active-ish" slot for singleton uniqueness.
 * Every driver's singleton dedup binds this list rather than inlining the three names.
 */
export const ACTIVE_STATUSES: readonly JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.ACTIVE,
  JobStatus.RETRY,
];
