import type { MigrationStep } from '../../../driver/driver.interface.js';
import { TableName } from '../../table-names.js';
import { buildSchemaStatements } from '../../schema-definition.js';

/**
 * Ordered, numbered migration steps. Each is checksum-guarded.
 * Migration 1 creates the base schema (queue, job, schedule, instance, migration).
 * Migration 2 adds the schedule `idempotency_key` column for cross-table dedup.
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
  {
    version: 2,
    checksum: 'v2-schedule-idempotency-key',
    async up(driver, context) {
      const schedule = context.tableNames.bare(TableName.SCHEDULE);
      // Plainest portable form: `ALTER TABLE ... ADD COLUMN ... TEXT` is understood by every
      // create-schema target (PG-family + SQLite), matching the engine-neutral base DDL. No
      // UPSERT/engine-specific syntax; a nullable column with no default needs no backfill.
      await driver.runInTransaction({
        fn: async (tx) => {
          await tx.execute(`ALTER TABLE ${schedule} ADD COLUMN idempotency_key TEXT`, []);
        },
      });
    },
  },
];
