import { FINISHED_STATUSES, JobStatus } from '../../jobs/job-state.enum';

/**
 * How a job's `retention_statuses` column is encoded, and how a query matches against it.
 *
 * Retention is resolved **per job** and frozen onto its row, so the statuses a policy applies to have
 * to travel with the job rather than be re-read from a queue's live options. That is one small fixed
 * set per row, which rules out a side table (the no-JOIN invariant).
 *
 * The encoding is a **bitmask integer**, one bit per finished status. It used to be a comma-delimited
 * token list matched with `LIKE '%,COMPLETED,%'`, and that was the problem: a leading-wildcard `LIKE`
 * is unindexable on every engine here, and the retention sweep `OR`ed four of them — so each batch
 * ran four pattern matches per candidate row on top of the scan it could not avoid. A bitmask is one
 * integer test per row against a bound constant, in a fraction of the bytes.
 *
 * `NULL` still means "every finished status" — the default, and the cheapest row to store.
 *
 * This is encoding mechanism, not SQL: every driver builds its own statement and calls these to
 * produce the bound values.
 */

/**
 * The bit for one finished status — its position in {@link FINISHED_STATUSES}.
 *
 * That order is now part of the stored format, so a status may be **appended** to that list but never
 * reordered or removed: doing so would silently re-interpret every row already written.
 */
function bit(status: JobStatus): number {
  const index = FINISHED_STATUSES.indexOf(status);
  return index === -1 ? 0 : 1 << index;
}

/** Encode a resolved status list for storage, or `null` for "every finished status". */
export function encodeRetentionStatuses(statuses: readonly JobStatus[] | null): number | null {
  if (!statuses || statuses.length === 0) return null;
  // Deduplicated by construction — a bit is set or it isn't — so two equivalent policies always
  // produce the same stored value.
  const unique = FINISHED_STATUSES.filter((s) => statuses.includes(s));
  // "All of them" is the same policy as "unscoped", and NULL is the cheaper way to say it.
  if (unique.length === 0 || unique.length === FINISHED_STATUSES.length) return null;
  return unique.reduce((mask, status) => mask | bit(status), 0);
}

/** Decode a stored value back to the list a caller sees, or `null` when unscoped. */
export function decodeRetentionStatuses(value: unknown): JobStatus[] | null {
  if (value == null) return null;
  const mask = Number(value);
  if (!Number.isFinite(mask) || mask === 0) return null;
  const statuses = FINISHED_STATUSES.filter((status) => (mask & bit(status)) !== 0);
  return statuses.length ? statuses : null;
}

/**
 * The bound value a query tests `retention_statuses` against for one status: that status's bit. A row
 * is eligible when `retention_statuses & <bit> <> 0`, or when the column is NULL — which every
 * driver's predicate checks first.
 */
export function retentionStatusBit(status: JobStatus): number {
  return bit(status);
}
