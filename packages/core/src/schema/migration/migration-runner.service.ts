import { MigrationMode } from '../../options/enums.js';
import { PortQueueEvent } from '../../events/event-name.enum.js';
import { MigrationFailedError, SchemaVersionMismatchError } from '../../errors/errors.js';
import { DriverCapability } from '../../driver/driver-capabilities.js';
import { CURRENT_SCHEMA_VERSION } from '../schema-definition.js';
import { MIGRATIONS } from './migrations/index.js';
import type { Driver } from '../../driver/driver.interface.js';
import type { DriverContext } from '../../driver/driver-context.js';
import type { Logger } from '../../logging/logger.interface.js';
import type { EventBusService } from '../../events/event-bus.service.js';

/**
 * Applies ordered, checksum-guarded migrations. Race-safe across
 * instances via an advisory lock where available. Supports AUTO / MANUAL / VALIDATE_ONLY.
 */
export class MigrationRunner {
  constructor(
    private readonly driver: Driver,
    private readonly context: DriverContext,
    private readonly logger: Logger,
    private readonly events: EventBusService,
  ) {}

  async run(mode: MigrationMode): Promise<void> {
    if (mode === MigrationMode.MANUAL) {
      this.logger.info(
        'Migration mode is MANUAL; skipping auto-migrate. Run `portqueue migrate` to apply.',
      );
      return;
    }
    const current = await this.driver.getSchemaVersion();
    if (mode === MigrationMode.VALIDATE_ONLY) {
      if ((current ?? 0) !== CURRENT_SCHEMA_VERSION) {
        throw new SchemaVersionMismatchError(current, CURRENT_SCHEMA_VERSION);
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
    const pending = MIGRATIONS.filter((m) => m.version > (current ?? 0)).sort(
      (a, b) => a.version - b.version,
    );
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
        await this.waitForVersion(CURRENT_SCHEMA_VERSION);
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
      this.events.emit(PortQueueEvent.MIGRATION_APPLIED, { from, to: CURRENT_SCHEMA_VERSION });
    } finally {
      if (locked && this.driver.releaseAdvisoryLock) {
        await this.driver.releaseAdvisoryLock({ key: lockKey }).catch(() => undefined);
      }
    }
  }

  private async waitForVersion(target: number, timeoutMs = 30000): Promise<void> {
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
