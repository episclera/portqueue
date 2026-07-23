// TODO(oracle): Oracle needs its own DDL — VARCHAR2/NUMBER physical types and no
// `CREATE TABLE IF NOT EXISTS` (pre-23c). Until that dedicated pass it reuses the Postgres set
// (unverified on Oracle), matching the prior engine-neutral behaviour.
export { POSTGRES_MIGRATIONS as ORACLE_MIGRATIONS } from '../postgres/index.js';
