import type { TableName } from './table-names.js';

/**
 * The schema expressed as data — the source of truth lives as versioned JSON under `versions/`.
 * Each {@link SchemaDef} lists its tables and columns with a logical {@link ColumnType}. It is NOT
 * rendered to SQL at runtime: the actual DDL is **predefined per database flavour** under
 * `migrations/<flavour>/`, authored from these definitions. Add a version by adding a
 * `versions/vN.ts` and the matching per-flavour migration statements.
 */

/** Logical column types; each flavour's migration files pick the physical type they use. */
export enum ColumnType {
  TEXT = 'TEXT',
  INTEGER = 'INTEGER',
  BIGINT = 'BIGINT',
  SMALLINT = 'SMALLINT',
  REAL = 'REAL',
}

export interface ColumnDef {
  name: string;
  type: ColumnType;
  notNull?: boolean;
  /** A rendered default literal (a number, or a quoted string like `"'FIXED'"`). */
  default?: string | number;
}

export interface TableDef {
  name: TableName;
  columns: ColumnDef[];
}

export interface SchemaDef {
  version: number;
  /** Stable identifier recorded with the applied migration for this version. */
  checksum: string;
  tables: TableDef[];
}
