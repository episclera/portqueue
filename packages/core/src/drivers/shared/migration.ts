import type { MigrationStep } from '../driver.interface';
import type { TableName } from '../table-names';

/**
 * The naming helpers a migration's DDL needs.
 *
 * - `name(t)` is the name a statement must reference — schema-qualified when the driver was given a
 *   `schema`, so the objects really are created in it.
 * - `derived(t, suffix)` names an object the engine files *inside* that table's own schema (an
 *   index, a constraint), which must therefore stay unqualified.
 * - `schema` is the configured schema, for a flavour whose engine can create one.
 */
export interface MigrationNames {
  name(table: TableName): string;
  derived(table: TableName, suffix: string): string;
  schema: string | undefined;
}

/**
 * A predefined migration for one engine at one schema version. `statements` returns the DDL for
 * that step with object names resolved. Each driver authors its own array alongside the driver
 * (`drivers/<engine>/migrations.ts`) — never shared or generated at runtime, so a change to one
 * engine's DDL can never leak into another's.
 *
 * A migration is identified by its `version` and nothing else. There is deliberately no checksum:
 * nothing ever compared one, and a value written but never read states a guarantee the code does
 * not make.
 */
export interface FlavourMigration {
  version: number;
  statements(names: MigrationNames): string[];
}

/**
 * Wrap a driver's authored {@link FlavourMigration} list into the runner's {@link MigrationStep}
 * units — resolving object names against the live context, and nothing else. The driver's
 * `applyMigration` runs the statements *and* records the version in one transaction, so a crash
 * can never leave an applied-but-unrecorded migration. This is the only piece of the migration
 * path shared across engines: the mechanism, never the SQL.
 */
export function toMigrationSteps(migrations: FlavourMigration[]): MigrationStep[] {
  return migrations.map((migration) => ({
    version: migration.version,
    statements: (context) =>
      migration.statements({
        name: (t) => context.tableNames.qualified(t),
        derived: (t, suffix) => context.tableNames.derived(t, suffix),
        schema: context.tableNames.schema,
      }),
  }));
}

/** The highest version among a migration set (the schema version a build ships). */
export function latestVersion(migrations: MigrationStep[]): number {
  return migrations.reduce((max, m) => (m.version > max ? m.version : max), 0);
}
