import { DatabaseEngine } from '../options/enums.js';
import { TableName, type TableNames } from './table-names.js';
import { renderSchema, SchemaFlavour } from './schema-model.js';
import { SCHEMA_VERSIONS, schemaAtVersion } from './schema-versions.js';

/**
 * The base-schema DDL is rendered from the versioned schema model (see `schema-versions.ts` /
 * `schema-model.ts`) rather than hand-written. Storage is engine-neutral: timestamps/durations as
 * BIGINT epoch-ms, JSON as TEXT, booleans as SMALLINT 0/1. Relationships link by **name or key**
 * (no cross-table joins); a minimal set of tables keeps every row independently shardable. Indexes,
 * constraints and shard keys — where an engine supports them — are a per-flavour concern the driver
 * dialect layer adds; the core logic enforces every invariant regardless.
 */

/** Which DDL dialect a given engine renders. PGLite shares Postgres; others default to PG for now. */
export function schemaFlavourForEngine(engine: DatabaseEngine): SchemaFlavour {
  return engine === DatabaseEngine.SQLITE ? SchemaFlavour.SQLITE : SchemaFlavour.PG;
}

/** The base (version 1) schema statements for a flavour; migration 1 runs these on a fresh DB. */
export function buildSchemaStatements(
  t: TableNames,
  flavour: SchemaFlavour = SchemaFlavour.PG,
): string[] {
  return renderSchema(flavour, schemaAtVersion(1), (name: TableName) => t.bare(name));
}

/** The current schema version this build ships (the latest declared version). */
export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSIONS[SCHEMA_VERSIONS.length - 1]!.version;
