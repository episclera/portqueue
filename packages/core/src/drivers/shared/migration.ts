import type { MigrationStep } from '../driver.interface.js';
import type { TableName } from '../table-names.js';

/** Resolves a logical {@link TableName} to its physical, prefixed name (e.g. `pq_job`). */
export type PhysicalName = (t: TableName) => string;

/**
 * A predefined migration for one engine at one schema version. `statements` returns the DDL for
 * that step with table names resolved. Each driver authors its own array alongside the driver
 * (`drivers/<engine>/migrations.ts`) — never shared or generated at runtime, so a change to one
 * engine's DDL can never leak into another's.
 */
export interface FlavourMigration {
  version: number;
  checksum: string;
  statements(name: PhysicalName): string[];
}

/**
 * Wrap a driver's authored {@link FlavourMigration} list into the runner's {@link MigrationStep}
 * units. Each step resolves table names against the live context and applies its statements inside
 * the driver's own transaction (single or multi statement alike). This is the only piece of the
 * migration path that is shared across engines — the mechanism, not the SQL.
 */
export function toMigrationSteps(migrations: FlavourMigration[]): MigrationStep[] {
  return migrations.map((migration) => ({
    version: migration.version,
    checksum: migration.checksum,
    async up(driver, context) {
      const statements = migration.statements((t) => context.tableNames.bare(t));
      await driver.runInTransaction({
        fn: async (tx) => {
          for (const sql of statements) {
            await tx.execute(sql, []);
          }
        },
      });
    },
  }));
}

/** The highest version among a migration set (the schema version a build ships). */
export function latestVersion(migrations: MigrationStep[]): number {
  return migrations.reduce((max, m) => (m.version > max ? m.version : max), 0);
}
