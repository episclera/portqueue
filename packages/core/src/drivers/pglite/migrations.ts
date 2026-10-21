import type { FlavourMigration } from '../shared/migration';
// --- Compatible with PostgreSQL: reused verbatim ---
// PGLite is PostgreSQL compiled to WASM, so every version below emits byte-for-byte the DDL the
// PostgreSQL flavour emits. Rather than keep a second copy in sync by hand, the statement builders
// are imported from the PostgreSQL flavour and referenced here.
import { v1 as postgresqlV1 } from '../postgresql/migrations';

/**
 * Predefined PGLite DDL, version by version. Authored by hand for this engine; not generated at
 * runtime.
 *
 * `PGLITE_MIGRATIONS` is PGLite's own array — the runner only ever reads this one — but each entry
 * points at the PostgreSQL statement builder because the two dialects are identical, keys, partial
 * indexes and `CREATE SCHEMA IF NOT EXISTS` included. There is a single version so far; a future
 * change appends `{ version: 2, ... }` rather than editing v1, which is a frozen record of what has
 * already been applied.
 *
 * --- Custom to PGLite ---
 * Nothing yet. When a version needs to diverge (e.g. dropping a clause the WASM build rejects),
 * author a local `v<n>(names: MigrationNames): string[]` here (`MigrationNames` comes from
 * `../shared/migration`) and swap it into the array for that version only; every other version
 * keeps reusing PostgreSQL. Spell its column names as raw string literals, never the `*Column` enums
 * — renaming an enum member must never retroactively rewrite a past migration's DDL.
 */

export const PGLITE_MIGRATIONS: FlavourMigration[] = [{ version: 1, statements: postgresqlV1 }];
