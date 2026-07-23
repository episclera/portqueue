import { DatabaseEngine } from '../../options/enums.js';
import { TableName } from '../table-names.js';
import { SCHEMA_VERSIONS } from '../versions/index.js';
import {
  MIGRATIONS,
  SchemaFlavour,
  flavourForEngine,
  migrationsForFlavour,
} from './index.js';

const bare = (t: TableName): string => `pq_${t}`;

describe('predefined per-flavour migrations', () => {
  it('exposes one runner step per schema version, checksums aligned to the JSON', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(SCHEMA_VERSIONS.map((s) => s.version));
    expect(MIGRATIONS.map((m) => m.checksum)).toEqual(SCHEMA_VERSIONS.map((s) => s.checksum));
  });

  it('maps engines to flavours', () => {
    expect(flavourForEngine(DatabaseEngine.POSTGRES)).toBe(SchemaFlavour.POSTGRES);
    expect(flavourForEngine(DatabaseEngine.PGLITE)).toBe(SchemaFlavour.PGLITE);
    expect(flavourForEngine(DatabaseEngine.SQLITE)).toBe(SchemaFlavour.SQLITE);
    expect(flavourForEngine(DatabaseEngine.MYSQL)).toBe(SchemaFlavour.MYSQL);
    expect(flavourForEngine(DatabaseEngine.CUSTOM)).toBe(SchemaFlavour.POSTGRES);
  });

  it('Postgres v1 creates every table with the pruned job shape; v2 adds the schedule key', () => {
    const pg = migrationsForFlavour(SchemaFlavour.POSTGRES);
    const v1 = pg.find((m) => m.version === 1)!.statements(bare);
    expect(v1).toHaveLength(5);
    expect(v1.every((s) => s.startsWith('CREATE TABLE IF NOT EXISTS'))).toBe(true);
    const job = v1.find((s) => s.includes('pq_job'))!;
    expect(job).toContain('preferred_instance_key_pattern');
    expect(job).not.toMatch(/preferred_instance_key\b/);
    expect(job).not.toContain('fallback_instance_key');

    const v2 = pg.find((m) => m.version === 2)!.statements(bare);
    expect(v2).toEqual(['ALTER TABLE pq_schedule ADD COLUMN idempotency_key TEXT']);
  });

  it('MySQL avoids DEFAULT on TEXT by using VARCHAR for defaulted string columns', () => {
    const job = migrationsForFlavour(SchemaFlavour.MYSQL)
      .find((m) => m.version === 1)!
      .statements(bare)
      .find((s) => s.includes('pq_job'))!;
    expect(job).toContain("retry_backoff VARCHAR(32) NOT NULL DEFAULT 'FIXED'");
    expect(job).toContain("retention_mode VARCHAR(32) NOT NULL DEFAULT 'KEEP_FOREVER'");
    expect(job).not.toMatch(/TEXT NOT NULL DEFAULT/);
  });

  it('PG-wire family (pglite/yugabyte/citus) reuses the Postgres statements', () => {
    const pgV1 = migrationsForFlavour(SchemaFlavour.POSTGRES).find((m) => m.version === 1)!.statements(bare);
    for (const f of [SchemaFlavour.PGLITE, SchemaFlavour.YUGABYTE, SchemaFlavour.CITUS]) {
      const v1 = migrationsForFlavour(f).find((m) => m.version === 1)!.statements(bare);
      expect(v1).toEqual(pgV1);
    }
  });
});
