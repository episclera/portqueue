// SQLite accepts the Postgres-family DDL verbatim: TEXT/BIGINT/INTEGER/SMALLINT/REAL resolve via
// type affinity, DEFAULTs on TEXT columns are allowed, and `ALTER TABLE ADD COLUMN` is supported.
export { POSTGRES_MIGRATIONS as SQLITE_MIGRATIONS } from '../postgres/index.js';
