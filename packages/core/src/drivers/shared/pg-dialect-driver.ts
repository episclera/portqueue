import {
  capabilities,
  DriverCapability,
  type DriverCapabilitySet,
} from '../../driver/driver-capabilities.js';
import { SqlDriver } from './sql-driver.js';

/**
 * Shared Postgres-dialect base. PGLite and Postgres share ~90% of SQL;
 * both use `$1`-style placeholders and support SKIP LOCKED / RETURNING / transactions. Concrete
 * drivers provide connection management and the notify decision.
 */
export abstract class PgDialectDriver extends SqlDriver {
  protected readonly placeholderStyle = 'dollar' as const;

  protected pgCapabilities(
    extra: Partial<Record<DriverCapability, boolean>> = {},
  ): DriverCapabilitySet {
    return capabilities({
      [DriverCapability.SKIP_LOCKED]: true,
      [DriverCapability.RETURNING]: true,
      [DriverCapability.TRANSACTIONS]: true,
      ...extra,
    });
  }
}
