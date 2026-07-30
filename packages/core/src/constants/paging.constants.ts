/** Paging defaults. One window shape (`limit`/`offset`) for every list read. */

/** Rows a list read returns when the caller names no `limit`. */
export const DEFAULT_PAGE_LIMIT = 50;

/** The ceiling a caller-supplied `limit` is clamped to on the public API. */
export const MAX_PAGE_LIMIT = 500;

/** The ceiling the dashboard facade clamps its own pages to (its tables never show more). */
export const DASHBOARD_MAX_PAGE_LIMIT = 200;
