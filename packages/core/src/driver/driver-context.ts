import { TableNames } from '../schema/table-names.js';

/**
 * Shared value object passed to a driver so all object names are computed once
 *. Also carries the pub/sub namespace.
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
    this.namespace = options.namespace ?? 'portqueue';
  }
}
