import type { SchemaDef } from '../model.js';
import { V1 } from './v1.js';
import { V2 } from './v2.js';

/**
 * All schema versions, ascending — the JSON source of truth. The last entry is the shape this
 * build ships. Concrete DDL is predefined per flavour under `../migrations/<flavour>/`, authored
 * from these definitions (no runtime SQL generation).
 */
export const SCHEMA_VERSIONS: readonly SchemaDef[] = [V1, V2];

/** The current schema version this build ships (the latest declared version). */
export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSIONS[SCHEMA_VERSIONS.length - 1]!.version;

/** The schema definition for a given version. Throws if unknown. */
export function schemaAtVersion(version: number): SchemaDef {
  const found = SCHEMA_VERSIONS.find((s) => s.version === version);
  if (!found) throw new Error(`No schema definition for version ${version}.`);
  return found;
}
