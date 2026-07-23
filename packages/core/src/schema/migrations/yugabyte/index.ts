// Yugabyte YSQL speaks the Postgres wire protocol; the base DDL is identical. Distribution hints
// (colocation, `SPLIT INTO`) are a future, additive per-table concern and are not needed to run.
export { POSTGRES_MIGRATIONS as YUGABYTE_MIGRATIONS } from '../postgres/index.js';
