import type { TableName } from '../table-names.js';

/** Resolves a logical {@link TableName} to its physical, prefixed name (e.g. `pq_job`). */
export type PhysicalName = (t: TableName) => string;

/**
 * A predefined migration for one flavour at one schema version. `statements` returns the DDL for
 * that step with table names resolved — authored per flavour, never generated at runtime.
 */
export interface FlavourMigration {
  version: number;
  checksum: string;
  statements(name: PhysicalName): string[];
}

/** Which predefined migration set an engine uses. Several engines can share one (PG-wire family). */
export enum SchemaFlavour {
  POSTGRES = 'POSTGRES',
  PGLITE = 'PGLITE',
  SQLITE = 'SQLITE',
  ORACLE = 'ORACLE',
  MYSQL = 'MYSQL',
  YUGABYTE = 'YUGABYTE',
  CITUS = 'CITUS',
}
