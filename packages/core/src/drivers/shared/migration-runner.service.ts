import { MigrationMode } from '../../options/enums';
import { PortQueueEvent } from '../../events/event-name.enum';
import { MigrationFailedError, SchemaVersionMismatchError } from '../../errors/errors';
import { DriverCapability } from '../driver-capabilities';
import { latestVersion } from './migration';
import type { Driver } from '../driver.interface';
import type { DriverContext } from '../driver-context';
import type { Logger } from '../../logging/logger.interface';
import type { EventBusService } from '../../events/event-bus.service';

/**
 * Applies a driver's ordered, checksum-guarded migrations. The steps come from the driver itself
 * (`driver.migrations`) — each engine authors its own DDL alongside its driver; this is the single
 * shared mechanism that runs them. Race-safe across instances via an advisory lock where
 * available. Supports AUTO / MANUAL / VALIDATE_ONLY.
 */
export class MigrationRunner {
  constructor(
    private readonly driver: Driver,
    private readonly context: DriverContext,
    private readonly logger: Logger,
    private readonly events: EventBusService,
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
    const pending = this.driver.migrations
      .filter((m) => m.version > (current ?? 0))
      .sort((a, b) => a.version - b.version);
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
    }
    try {
      const from = current;
      for (const migration of pending) {
        try {
          await this.driver.applyMigration({ migration });
          this.logger.info(`Applied migration v${migration.version}.`);
        } catch (err) {
          throw new MigrationFailedError(`Migration v${migration.version} failed.`, err);
        }
      }
      this.events.emit(PortQueueEvent.MIGRATION_APPLIED, { from, to: this.targetVersion });
    } finally {
      if (locked && this.driver.releaseAdvisoryLock) {
        await this.driver.releaseAdvisoryLock({ key: lockKey }).catch(() => undefined);
      }
    }
  }

  private async waitForVersion(target: number, timeoutSeconds = 30): Promise<void> {
    const timeoutMs = timeoutSeconds * 1000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const v = await this.driver.getSchemaVersion();
      if ((v ?? 0) >= target) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new MigrationFailedError(
      'Timed out waiting for another instance to complete migrations.',
    );
  }
}
