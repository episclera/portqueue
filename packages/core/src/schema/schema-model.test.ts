import { SchemaFlavour } from './schema-model.js';
import { schemaAtVersion } from './schema-versions.js';
import { diffSchema, migrationStatementsFor } from './migration/generate.js';
import { TableName } from './table-names.js';

const bare = (t: TableName): string => `pq_${t}`;

describe('schema model + migration generation', () => {
  it('renders v1 as one CREATE TABLE per table, with the pruned job shape', () => {
    const stmts = migrationStatementsFor(1, SchemaFlavour.PG, bare);
    expect(stmts).toHaveLength(schemaAtVersion(1).tables.length);
    expect(stmts.every((s) => s.startsWith('CREATE TABLE IF NOT EXISTS'))).toBe(true);
    const job = stmts.find((s) => s.includes('pq_job'))!;
    expect(job).toContain('preferred_instance_key_pattern');
    // The removed exact/fallback affinity columns must not reappear.
    expect(job).not.toMatch(/preferred_instance_key\b/);
    expect(job).not.toContain('fallback_instance_key');
  });

  it('generates v2 by diffing v1→v2: a single ADD COLUMN for the schedule key', () => {
    const stmts = migrationStatementsFor(2, SchemaFlavour.PG, bare);
    expect(stmts).toEqual(['ALTER TABLE pq_schedule ADD COLUMN idempotency_key TEXT']);
  });

  it('diffSchema emits CREATE for a new table and ADD COLUMN for a new column', () => {
    const prev = schemaAtVersion(1);
    const next = schemaAtVersion(2);
    const diff = diffSchema(prev, next, SchemaFlavour.SQLITE, bare);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toContain('ADD COLUMN idempotency_key');
  });
});
