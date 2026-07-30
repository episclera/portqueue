import { FINISHED_STATUSES, JobStatus } from '../../jobs/job-state.enum';

/**
 * How a job's `retention_statuses` column is encoded, and how a query matches against it.
 *
 * Retention is resolved **per job** and frozen onto its row, so the statuses a policy applies to
 * have to travel with the job rather than be re-read from a queue's live options. That is one small
 * list per row, which rules out a side table (the no-JOIN invariant) and makes a text column the
 * honest choice.
 *
 * The encoding is a comma-delimited list with **leading and trailing delimiters** —
 * `,COMPLETED,FAILED,` — so a containment test is a single `LIKE '%,COMPLETED,%'` that cannot match
 * a partial token. `NULL` means "every finished status", which is both the default and the cheapest
 * row to store.
 *
 * This is encoding mechanism, not SQL: every driver builds its own statement and calls these to
 * produce the bound values.
 */

const DELIMITER = ',';

/** Encode a resolved status list for storage, or `null` for "every finished status". */
export function encodeRetentionStatuses(statuses: readonly JobStatus[] | null): string | null {
  if (!statuses || statuses.length === 0) return null;
  // Deduplicate and order canonically so two equivalent policies produce the same stored value.
  const unique = FINISHED_STATUSES.filter((s) => statuses.includes(s));
  if (unique.length === 0 || unique.length === FINISHED_STATUSES.length) return null;
  return `${DELIMITER}${unique.join(DELIMITER)}${DELIMITER}`;
}

/** Decode a stored value back to the list a caller sees, or `null` when unscoped. */
export function decodeRetentionStatuses(value: unknown): JobStatus[] | null {
  if (value == null) return null;
  const parts = String(value)
    .split(DELIMITER)
    .filter((part) => part.length > 0);
  const statuses = parts.filter((part): part is JobStatus =>
    (FINISHED_STATUSES as readonly string[]).includes(part),
  );
  return statuses.length ? statuses : null;
}

/**
 * The bound `LIKE` pattern that tests whether an encoded list contains `status`. The delimiters
 * come from the encoding above, so `,FAILED,` can never be matched by a search for `AILED`.
 */
export function retentionStatusPattern(status: JobStatus): string {
  return `%${DELIMITER}${status}${DELIMITER}%`;
}
