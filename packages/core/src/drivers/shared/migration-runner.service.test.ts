/**
 * The shared migration runner: what it applies, in what order, and how it behaves when it cannot get
 * a lock.
 *
 * Driven against a fake `Driver` rather than an engine, deliberately — every branch here is about
 * *mechanism* (ordering, the advisory lock, the wait, the version read-back), and reproducing "the
 * version did not get recorded" on a real database would mean killing a process mid-migration.
 */
import { MigrationRunner } from './migration-runner.service';
import { MigrationMode } from '../../options/enums';
import { PortQueueEvent } from '../../events/event-name.enum';
import { DriverCapability } from '../driver-capabilities';
import { DriverContext } from '../driver-context';
import { MigrationFailedError, SchemaVersionMismatchError } from '../../errors/errors';
import { EventBusService } from '../../events/event-bus.service';
import { NoopLogger } from '../../logging/console-logger';
import { FakeClock } from '../../util/clock';
import type { Driver, MigrationStep } from '../driver.interface';

interface FakeOptions {
  /** Versions already applied before the run. */
  applied?: number[];
  /** Versions the driver ships. */
  ships?: number[];
  /** Whether this engine has a named lock, and whether the attempt wins it. */
  lock?: 'none' | 'won' | 'lost';
  /** Versions whose statements throw. */
  failOn?: number[];
  /** Versions that run but are never recorded — the MySQL/Oracle crash-in-between case. */
  loseRecordFor?: number[];
}

function fakeDriver(options: FakeOptions = {}) {
  const applied = new Set(options.applied ?? []);
  const ships = options.ships ?? [1];
  const ran: number[] = [];
  const locks: string[] = [];
  const released: string[] = [];

  const migrations: MigrationStep[] = ships.map((version) => ({
    version,
    statements: () => [`-- v${version}`],
  }));

  const driver = {
    capabilities: { [DriverCapability.ADVISORY_LOCK]: options.lock && options.lock !== 'none' },
    context: new DriverContext({}),
    migrations,
    getSchemaVersion: async () => (applied.size ? Math.max(...applied) : null),
    applyMigration: async ({ migration }: { migration: MigrationStep }) => {
      if (options.failOn?.includes(migration.version)) {
        throw new Error(`v${migration.version} blew up`);
      }
      ran.push(migration.version);
      if (!options.loseRecordFor?.includes(migration.version)) applied.add(migration.version);
    },
    tryAdvisoryLock:
      options.lock && options.lock !== 'none'
        ? async ({ key }: { key: string }) => {
            locks.push(key);
            return options.lock === 'won';
          }
        : undefined,
    releaseAdvisoryLock: async ({ key }: { key: string }) => void released.push(key),
  } as unknown as Driver;

  return { driver, ran, locks, released, applied };
}

function runnerFor(driver: Driver): { runner: MigrationRunner; events: PortQueueEvent[] } {
  const bus = new EventBusService(new NoopLogger());
  const events: PortQueueEvent[] = [];
  bus.on(
    PortQueueEvent.MIGRATION_APPLIED,
    () => void events.push(PortQueueEvent.MIGRATION_APPLIED),
  );
  return {
    runner: new MigrationRunner(
      driver,
      driver.context,
      new NoopLogger(),
      bus,
      new FakeClock(1_700_000_000_000),
    ),
    events,
  };
}

describe('AUTO', () => {
  it('applies pending versions in ascending order, whatever order they are declared in', async () => {
    // The applied set has to be a contiguous prefix for `MAX(version)` to be a truthful answer, and
    // that starts with never applying v3 before v2.
    const fake = fakeDriver({ ships: [3, 1, 2] });
    const { runner, events } = runnerFor(fake.driver);

    await runner.run(MigrationMode.AUTO);

    expect(fake.ran).toEqual([1, 2, 3]);
    expect(events).toEqual([PortQueueEvent.MIGRATION_APPLIED]);
  });

  it('applies only what is missing', async () => {
    const fake = fakeDriver({ ships: [1, 2, 3], applied: [1, 2] });
    const { runner } = runnerFor(fake.driver);

    await runner.run(MigrationMode.AUTO);

    expect(fake.ran).toEqual([3]);
  });

  it('does nothing, and emits nothing, when the schema is current', async () => {
    const fake = fakeDriver({ ships: [1], applied: [1] });
    const { runner, events } = runnerFor(fake.driver);

    await runner.run(MigrationMode.AUTO);

    expect(fake.ran).toEqual([]);
    expect(events).toEqual([]);
  });

  it('stops at the version that failed and leaves the rest unapplied', async () => {
    const fake = fakeDriver({ ships: [1, 2, 3], failOn: [2] });
    const { runner, events } = runnerFor(fake.driver);

    await expect(runner.run(MigrationMode.AUTO)).rejects.toThrow(MigrationFailedError);
    expect(fake.ran).toEqual([1]);
    // No "applied" event for a run that did not finish.
    expect(events).toEqual([]);
  });

  it('refuses to carry on when a version ran but was not recorded', async () => {
    // MySQL and Oracle commit DDL implicitly, so `applyMigration` cannot be atomic there: a crash
    // between the statements and the version insert leaves the schema reading one version behind.
    // Continuing would apply v2 on top of an unrecorded v1 and report the whole set as applied.
    const fake = fakeDriver({ ships: [1, 2], loseRecordFor: [1] });
    const { runner } = runnerFor(fake.driver);

    await expect(runner.run(MigrationMode.AUTO)).rejects.toThrow(/ran but was not recorded/);
    expect(fake.ran).toEqual([1]);
  });
});

describe('the advisory lock', () => {
  it('takes the lock when the engine has one, and releases it afterwards', async () => {
    const fake = fakeDriver({ lock: 'won' });
    const { runner } = runnerFor(fake.driver);

    await runner.run(MigrationMode.AUTO);

    expect(fake.locks).toEqual(['pq_migrate']);
    expect(fake.released).toEqual(['pq_migrate']);
    expect(fake.ran).toEqual([1]);
  });

  it('releases the lock even when a migration fails', async () => {
    const fake = fakeDriver({ lock: 'won', failOn: [1] });
    const { runner } = runnerFor(fake.driver);

    await expect(runner.run(MigrationMode.AUTO)).rejects.toThrow(MigrationFailedError);
    expect(fake.released).toEqual(['pq_migrate']);
  });

  it('waits for the other instance instead of migrating when it loses the lock', async () => {
    // Whoever holds the lock is applying; a loser that migrated anyway would run the same DDL
    // concurrently. Here the winner's work lands while the loser polls.
    const fake = fakeDriver({ lock: 'lost' });
    fake.applied.add(1); // the holder finished before the first poll
    const { runner } = runnerFor(fake.driver);

    await runner.run(MigrationMode.AUTO);

    expect(fake.ran).toEqual([]);
  });

  it('applies without a lock on an engine that has none', async () => {
    // Oracle, SQLite, PGLite. Safe because every engine's DDL is idempotent — the alternative,
    // waiting for a lock nobody can take, would deadlock a first boot.
    const fake = fakeDriver({ lock: 'none' });
    const { runner } = runnerFor(fake.driver);

    await runner.run(MigrationMode.AUTO);

    expect(fake.locks).toEqual([]);
    expect(fake.ran).toEqual([1]);
  });
});

describe('the other modes', () => {
  it('MANUAL applies nothing at all', async () => {
    const fake = fakeDriver({ ships: [1, 2] });
    const { runner } = runnerFor(fake.driver);

    await runner.run(MigrationMode.MANUAL);

    expect(fake.ran).toEqual([]);
  });

  it('VALIDATE_ONLY passes on a current schema and throws on a stale one', async () => {
    const current = fakeDriver({ ships: [1], applied: [1] });
    await expect(
      runnerFor(current.driver).runner.run(MigrationMode.VALIDATE_ONLY),
    ).resolves.toBeUndefined();

    const stale = fakeDriver({ ships: [1, 2], applied: [1] });
    await expect(runnerFor(stale.driver).runner.run(MigrationMode.VALIDATE_ONLY)).rejects.toThrow(
      SchemaVersionMismatchError,
    );
    expect(stale.ran).toEqual([]);
  });

  it('migrate() applies pending versions whatever the mode was', async () => {
    // The programmatic `pq.migrate()` / `portqueue migrate` path.
    const fake = fakeDriver({ ships: [1, 2] });
    const { runner } = runnerFor(fake.driver);

    await runner.migrate();

    expect(fake.ran).toEqual([1, 2]);
  });
});
