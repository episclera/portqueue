import type { MigrationStep } from '../../../driver/driver.interface.js';
import { schemaFlavourForEngine } from '../../schema-definition.js';
import { SCHEMA_VERSIONS } from '../../schema-versions.js';
import { migrationStatementsFor } from '../generate.js';

/**
 * Ordered, checksum-guarded migration steps — **generated** from the versioned schema model, one
 * step per declared version. Each step, at run time, renders the right DDL for the driver's
 * flavour (via the diff generator), so a new schema version needs no hand-written migration: append
 * it in `schema-versions.ts` and the step appears here.
 */
export const MIGRATIONS: MigrationStep[] = SCHEMA_VERSIONS.map((schema) => ({
  version: schema.version,
  checksum: schema.checksum,
  async up(driver, context) {
    const flavour = schemaFlavourForEngine(driver.engine);
    const statements = migrationStatementsFor(schema.version, flavour, (t) =>
      context.tableNames.bare(t),
    );
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
