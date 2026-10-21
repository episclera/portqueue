import { DEFAULT_NAMESPACE } from '../constants';
import { TableNames } from './table-names';

/**
 * How a driver lays its data out in the database. Every field is per-engine: two drivers pointing
 * at different databases can use different schemas, prefixes, and namespaces, so these belong on
 * each driver's own options — not on the top-level client. Engines that have schemas honour
 * `schema` by qualifying every object name with it; SQLite has none and does not accept the option.
 */
export interface StorageOptions {
  /** DB schema/namespace (PostgreSQL/PGLite/MySQL/Oracle). */
  schema?: string;
  /** Prefix for all created tables (default 'pq_'). */
  tablePrefix?: string;
  /** Logical prefix for pub/sub channels when multiple PortQueues share one DB. */
  namespace?: string;
}

/**
 * Shared value object a driver builds from its {@link StorageOptions} so all object names are
 * computed once. Also carries the pub/sub namespace.
 */
export class DriverContext {
  readonly tableNames: TableNames;
  readonly namespace: string;

  constructor(options: {
    tablePrefix?: string;
    schema?: string;
    namespace?: string;
    maxIdentifierLen?: number;
  }) {
    this.tableNames = new TableNames({
      ...(options.tablePrefix !== undefined ? { tablePrefix: options.tablePrefix } : {}),
      ...(options.schema !== undefined ? { schema: options.schema } : {}),
      ...(options.maxIdentifierLen !== undefined
        ? { maxIdentifierLen: options.maxIdentifierLen }
        : {}),
    });
    this.namespace = options.namespace ?? DEFAULT_NAMESPACE;
  }
}
