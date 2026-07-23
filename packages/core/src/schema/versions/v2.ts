import { TableName } from '../table-names.js';
import { ColumnType, type SchemaDef, type TableDef } from '../model.js';
import { instance, job, migration, queue, scheduleV1 } from './v1.js';

/**
 * Schema **version 2** — adds the optional cross-table deduplication token `idempotency_key` to
 * the schedule table. The per-flavour migration statements apply this as an `ADD COLUMN`.
 */

const scheduleV2: TableDef = {
  name: TableName.SCHEDULE,
  columns: [
    ...scheduleV1.columns.slice(0, -2), // everything up to created_at/updated_at
    { name: 'idempotency_key', type: ColumnType.TEXT },
    ...scheduleV1.columns.slice(-2), // created_at, updated_at
  ],
};

export const V2: SchemaDef = {
  version: 2,
  checksum: 'v2-schedule-idempotency-key',
  tables: [queue, job, scheduleV2, instance, migration],
};
