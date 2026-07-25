/** Constants shared between the dashboard client and server (avoid literal drift). */

/** Header + marker the client sends on every request so the server can assert same-origin. */
export const REQUESTED_WITH_HEADER = 'x-requested-with';
export const REQUESTED_WITH_MARKER = 'portqueue-dashboard';

/**
 * How many recent jobs a `search` scans. The engine has no text index on job ids, so a search
 * filters a bounded window of the most recent matching jobs rather than issuing an unbounded
 * scan; the client names this number when it reports a truncated search.
 */
export const JOB_SEARCH_SCAN_LIMIT = 500;
