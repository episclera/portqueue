import { MigrationMode } from '../../options/enums';
import { PortQueueEvent } from '../../events/event-name.enum';
import { MigrationFailedError, SchemaVersionMismatchError } from '../../errors/errors';
import { DriverCapability } from '../driver-capabilities';
import { latestVersion } from './migration';
import { MIGRATION_WAIT_POLL_SECONDS, MIGRATION_WAIT_TIMEOUT_SECONDS } from '../../constants';
import { secondsToMs } from '../../util/seconds';
import type { Driver } from '../driver.interface';
import type { DriverContext } from '../driver-context';
import type { Logger } from '../../logging/logger.interface';
import type { EventBusService } from '../../events/event-bus.service';
import type { Clock } from '../../util/clock';

/**
 * Applies a driver's ordered migrations. The steps come from the driver itself
 * (`driver.migrations`) — each engine authors its own DDL alongside its driver; this is the single
 * shared mechanism that runs them. A migration is identified by its version and nothing else.
 * Supports AUTO / MANUAL / VALIDATE_ONLY.
 *
 * **Two rules make `MAX(version)` a truthful answer**, which matters because that is what
 * `getSchemaVersion` reads and what decides what is still pending:
 *
 * - Versions are applied in ascending order, and
 * - each one is **confirmed recorded** before the next is attempted. So the applied set is always a
 *   contiguous prefix, and there is no way to reach "v1 and v3 applied, v2 not" — the state in which
 *   a maximum would read as complete while a version was missing.
 *
 * **Concurrency.** Where the engine has a named lock (PostgreSQL' `pg_try_advisory_lock`, MySQL's
 * `GET_LOCK`) one instance migrates and the rest wait for the version to land. Where it does not
 * (Oracle, SQLite, PGLite) every instance proceeds, which is safe only because each engine's DDL is
 * written to be idempotent — `IF NOT EXISTS`, `MERGE`, PL/SQL-guarded `CREATE INDEX` — and because
 * the confirmation above turns a half-applied step into an error rather than a silent skip. For a
 * multi-instance Oracle deployment, running `portqueue migrate` once before starting workers is
 * still the recommendation; see the production docs.
 */
export class MigrationRunner {
  constructor(
    private readonly driver: Driver,
    private readonly context: DriverContext,
    private readonly logger: Logger,
    private readonly events: EventBusService,
    private readonly clock: Clock,
  ) {}

  /** The schema version this driver's migration set ships (its latest step). */
  private get targetVersion(): number {
    return latestVersion(this.driver.migrations);
  }

  async run(mode: MigrationMode): Promise<void> {
    if (mode === MigrationMode.MANUAL) {
      this.logger.info(
        'Migration mode is MANUAL; skipping auto-migrate. Run `portqueue migrate` to apply.',
      );
      return;
    }
    const current = await this.driver.getSchemaVersion();
    if (mode === MigrationMode.VALIDATE_ONLY) {
      if ((current ?? 0) !== this.targetVersion) {
        throw new SchemaVersionMismatchError(current, this.targetVersion);
      }
      return;
    }
    await this.migrateAuto(current);
  }

  /** Force-apply (the programmatic `pq.migrate()` / CLI path). */
  async migrate(): Promise<void> {
    await this.migrateAuto(await this.driver.getSchemaVersion());
  }

  private async migrateAuto(current: number | null): Promise<void> {
    const ordered = [...this.driver.migrations].sort((a, b) => a.version - b.version);
    const pending = ordered.filter((m) => m.version > (current ?? 0));
    if (pending.length === 0) return;

    const useLock =
      this.driver.capabilities[DriverCapability.ADVISORY_LOCK] && this.driver.tryAdvisoryLock;
    const lockKey = `${this.context.tableNames.prefix}migrate`;
    let locked = false;
    if (useLock) {
      locked = await this.driver.tryAdvisoryLock!({ key: lockKey });
      if (!locked) {
        this.logger.debug('Another instance is migrating; waiting.');
        // Another instance is applying; poll until the version catches up.
        await this.waitForVersion(this.targetVersion);
        return;
      }
    } else {
      // No named lock on this engine. Every instance applies, which each engine's DDL is written to
      // survive; the confirmation below is what keeps a partial apply from reading as a complete one.
      this.logger.debug(
        'This engine offers no advisory lock; applying migrations without one. Concurrent first ' +
          'boots rely on the DDL being idempotent — run `portqueue migrate` first to avoid the race.',
      );
    }
    try {
      const from = current;
      for (const migration of pending) {
        try {
          await this.driver.applyMigration({ migration });
        } catch (err) {
          throw new MigrationFailedError(`Migration v${migration.version} failed.`, err);
        }
        // Read it back before moving on. On PostgreSQL, SQLite and PGLite the statements and the
        // version insert share a transaction, so this only ever confirms what is already true. On
        // MySQL and Oracle it cannot: DDL commits implicitly there, so `applyMigration` runs the
        // statements and *then* records the version, and a crash between the two would otherwise
        // leave a schema that reads as one version behind — the next start re-running (idempotent)
        // DDL, and any future non-idempotent step failing on it. Stopping here says so plainly.
        const recorded = await this.driver.getSchemaVersion();
        if ((recorded ?? 0) < migration.version) {
          throw new MigrationFailedError(
            `Migration v${migration.version} ran but was not recorded (the schema still reads as ` +
              `v${recorded ?? 0}). On an engine where DDL commits implicitly this can only mean the ` +
              `process was interrupted between the two; re-run the migration to finish it.`,
          );
        }
        this.logger.info(`Applied migration v${migration.version}.`);
      }
      this.events.emit(PortQueueEvent.MIGRATION_APPLIED, { from, to: this.targetVersion });
    } finally {
      if (locked && this.driver.releaseAdvisoryLock) {
        await this.driver.releaseAdvisoryLock({ key: lockKey }).catch(() => undefined);
      }
    }
  }

  /**
   * Poll until another instance's migration lands. Timed against the injected clock, like every
   * other deadline in the codebase, so a test with a fake clock controls this wait rather than
   * spending real seconds inside it.
   */
  private async waitForVersion(
    target: number,
    timeoutSeconds = MIGRATION_WAIT_TIMEOUT_SECONDS,
  ): Promise<void> {
    const timeoutMs = secondsToMs(timeoutSeconds, 'migration wait timeout');
    const pollMs = secondsToMs(MIGRATION_WAIT_POLL_SECONDS, 'migration wait poll');
    const deadline = this.clock.now() + timeoutMs;
    for (;;) {
      const v = await this.driver.getSchemaVersion();
      if ((v ?? 0) >= target) return;
      if (this.clock.now() >= deadline) break;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, pollMs);
        timer.unref?.();
      });
    }
    throw new MigrationFailedError(
      'Timed out waiting for another instance to complete migrations.',
    );
  }
}
