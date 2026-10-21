import { PortQueue } from '../../port-queue';
import { DatabaseEngine } from '../../options/enums';
import { DriverCapability } from '../driver-capabilities';
import { NoopLogger } from '../../logging/console-logger';
import { PostgresqlDriver } from '../postgresql/postgresql-driver';
import { PgliteDriver } from './index';

/**
 * PGLite inherits the whole SQL surface from `PostgresqlDriver` (same wire protocol, same dialect).
 * These tests pin down what must stay PGLite's own despite that, plus one live round-trip proving
 * the inherited queries really run through PGLite's own `execute`/`transaction`.
 */
describe('PgliteDriver extends PostgresqlDriver', () => {
  it('keeps its own identity, capabilities and migrations', () => {
    const driver = new PgliteDriver();
    expect(driver).toBeInstanceOf(PostgresqlDriver);
    expect(driver.engine).toBe(DatabaseEngine.PGLITE);
    // In-process: no shared notification bus and nothing to coordinate a lock with.
    expect(driver.capabilities[DriverCapability.LISTEN_NOTIFY]).toBe(false);
    expect(driver.capabilities[DriverCapability.ADVISORY_LOCK]).toBe(false);
    // Still PG-wire, so the claiming/returning paths stay on.
    expect(driver.capabilities[DriverCapability.SKIP_LOCKED]).toBe(true);
    expect(driver.capabilities[DriverCapability.RETURNING]).toBe(true);
    expect(driver.migrations.map((m) => m.version)).toEqual([1]);
  });

  it('boots its own connection, migrates to v1 and serves the inherited SQL', async () => {
    const driver = new PgliteDriver();
    const pq = new PortQueue<'emails'>({ driver, logger: new NoopLogger() });
    await pq.init();
    try {
      const probe = await driver.probe();
      expect(probe.serverVersion).toBe('pglite');
      expect(probe.verifiedCapabilities).not.toContain(DriverCapability.LISTEN_NOTIFY);
      expect(await driver.getSchemaVersion()).toBe(1);

      // The single v1 carries the schedule dedup column outright (no follow-up ALTER version).
      const cols = await driver.runInTransaction({
        fn: (tx) =>
          tx.execute(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'pq_schedule'`,
            [],
          ),
      });
      expect(cols.rows.map((r) => r.column_name)).toContain('idempotency_key');

      // An inherited write + its in-code dedup, run through PGLite's execute/transaction.
      const a = await pq.addJob({ queue: 'emails', data: { n: 1 }, idempotencyKey: 'k1' });
      const b = await pq.addJob({ queue: 'emails', data: { n: 2 }, idempotencyKey: 'k1' });
      expect(b.deduplicated).toBe(true);
      expect(b.jobId).toBe(a.jobId);
    } finally {
      await pq.shutdown({ graceful: false, timeoutSeconds: 0 });
    }
  }, 30000);
});
