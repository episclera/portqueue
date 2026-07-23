// Citus extends Postgres; the base DDL is identical. Distributing tables on the queue-name shard
// key (`SELECT create_distributed_table(...)`) is a future, additive step layered on these.
export { POSTGRES_MIGRATIONS as CITUS_MIGRATIONS } from '../postgres/index.js';
