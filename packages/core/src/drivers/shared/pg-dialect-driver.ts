import {
  capabilities,
  DriverCapability,
  type DriverCapabilitySet,
} from '../../driver/driver-capabilities.js';
import { SqlDriver } from './sql-driver.js';

/**
 * Shared Postgres-dialect base (build_plan/11.2). PGLite and Postgres share ~90% of SQL;
 * both use `$1`-style placeholders and support SKIP LOCKED / RETURNING / UPSERT. Concrete
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
      [DriverCapability.UPSERT]: true,
      ...extra,
    });
  }
}
