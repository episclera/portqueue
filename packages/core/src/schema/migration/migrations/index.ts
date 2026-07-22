import type { MigrationStep } from '../../../driver/driver.interface.js';
import { buildSchemaStatements } from '../../schema-definition.js';

/**
 * Ordered, numbered migration steps. Each is checksum-guarded.
 * Migration 1 creates the base schema (queue, job, schedule, instance, migration).
 */
export const MIGRATIONS: MigrationStep[] = [
  {
    version: 1,
    checksum: 'v1-base-schema',
    async up(driver, context) {
      const statements = buildSchemaStatements(context.tableNames);
      // Run each DDL statement through the driver's internal transaction machinery.
      await driver.runInTransaction({
        fn: async (tx) => {
          for (const sql of statements) {
            await tx.execute(sql, []);
          }
        },
      });
    },
  },
];
