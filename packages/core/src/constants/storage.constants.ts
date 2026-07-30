/** Storage-layout defaults every driver shares. */

/** Prefix on every physical table name. `<driver>Options.tablePrefix`. */
export const DEFAULT_TABLE_PREFIX = 'pq_';

/** Logical prefix for pub/sub channels when several PortQueues share one database. */
export const DEFAULT_NAMESPACE = 'portqueue';

/** Identifier length ceiling a driver assumes when it declares none (Postgres' limit). */
export const DEFAULT_MAX_IDENTIFIER_LEN = 63;

/**
 * How far the multi-instance claim path scans for affinity-matching candidates in one pass, as a
 * multiple of the requested batch (clamped by {@link AFFINITY_PAGE_MIN_HEADROOM} and
 * {@link AFFINITY_PAGE_MAX}). Affinity is a regex, which portable SQL cannot evaluate, so
 * candidates are paged and filtered in the tool.
 */
export const AFFINITY_PAGE_FACTOR = 5;
/** Extra rows added to a small batch so a single page is worth the round trip. */
export const AFFINITY_PAGE_MIN_HEADROOM = 20;
/** The largest affinity candidate page. */
export const AFFINITY_PAGE_MAX = 500;
/** Pages one claim will scan before giving up and letting the next tick resume from the top. */
export const AFFINITY_MAX_PAGES = 20;
/** The floor on total rows scanned, so a tiny batch still makes progress through a backlog. */
export const AFFINITY_MIN_SCAN = 2000;
