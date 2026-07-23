import { DatabaseEngine } from '../../options/enums.js';
import type { MigrationStep } from '../../driver/driver.interface.js';
import { SCHEMA_VERSIONS } from '../versions/index.js';
import { SchemaFlavour, type FlavourMigration } from './types.js';
import { POSTGRES_MIGRATIONS } from './postgres/index.js';
import { PGLITE_MIGRATIONS } from './pglite/index.js';
import { SQLITE_MIGRATIONS } from './sqlite/index.js';
import { ORACLE_MIGRATIONS } from './oracle/index.js';
import { MYSQL_MIGRATIONS } from './mysql/index.js';
import { YUGABYTE_MIGRATIONS } from './yugabyte/index.js';
import { CITUS_MIGRATIONS } from './citus/index.js';

export { SchemaFlavour } from './types.js';
export type { FlavourMigration, PhysicalName } from './types.js';

/** Predefined migration set per flavour. Each is authored (not generated) under its own folder. */
const REGISTRY: Record<SchemaFlavour, FlavourMigration[]> = {
  [SchemaFlavour.POSTGRES]: POSTGRES_MIGRATIONS,
  [SchemaFlavour.PGLITE]: PGLITE_MIGRATIONS,
  [SchemaFlavour.SQLITE]: SQLITE_MIGRATIONS,
  [SchemaFlavour.ORACLE]: ORACLE_MIGRATIONS,
  [SchemaFlavour.MYSQL]: MYSQL_MIGRATIONS,
  [SchemaFlavour.YUGABYTE]: YUGABYTE_MIGRATIONS,
  [SchemaFlavour.CITUS]: CITUS_MIGRATIONS,
};

/** Map a driver's engine to the migration flavour it should apply. */
export function flavourForEngine(engine: DatabaseEngine): SchemaFlavour {
  switch (engine) {
    case DatabaseEngine.SQLITE:
      return SchemaFlavour.SQLITE;
    case DatabaseEngine.ORACLE:
      return SchemaFlavour.ORACLE;
    case DatabaseEngine.MYSQL:
      return SchemaFlavour.MYSQL;
    case DatabaseEngine.PGLITE:
      return SchemaFlavour.PGLITE;
    // POSTGRES and CUSTOM fall back to the canonical Postgres set.
    default:
      return SchemaFlavour.POSTGRES;
  }
}

/** The predefined migrations for a flavour. */
export function migrationsForFlavour(flavour: SchemaFlavour): FlavourMigration[] {
  return REGISTRY[flavour];
}

/**
 * The ordered, checksum-guarded migration steps the runner applies. The version list + checksums
 * come from the JSON schema (`versions/`); each step, at run time, applies the **predefined**
 * statements for the driver's flavour (no runtime SQL generation).
 */
export const MIGRATIONS: MigrationStep[] = SCHEMA_VERSIONS.map((schema) => ({
  version: schema.version,
  checksum: schema.checksum,
  async up(driver, context) {
    const flavour = flavourForEngine(driver.engine);
    const step = migrationsForFlavour(flavour).find((m) => m.version === schema.version);
    if (!step) {
      throw new Error(`No ${flavour} migration defined for schema version ${schema.version}.`);
    }
    const statements = step.statements((t) => context.tableNames.bare(t));
    // Every migration runs inside the driver's own transaction (single or multi statement alike).
    await driver.runInTransaction({
      fn: async (tx) => {
        for (const sql of statements) {
          await tx.execute(sql, []);
        }
      },
    });
  },
}));
