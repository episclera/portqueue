/**
 * The abstract base custom-driver authors extend. PortQueue's SQL-dialect
 * base implements the whole {@link Driver} contract; a custom SQL driver overrides only
 * connection management, the placeholder style, and any dialect specifics.
 */
export { SqlDriver } from '../drivers/shared/sql-driver.js';
export { PgDialectDriver } from '../drivers/shared/pg-dialect-driver.js';
export type { RawResult, Session } from '../drivers/shared/sql-driver.js';
