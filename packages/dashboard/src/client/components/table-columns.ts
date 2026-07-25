/** Column builders shared by the tables that show a per-status count breakdown. */
import type { TableColumn } from '@portqueue/ui';
import { COUNT_STATUSES, STATUSES_CONFIG } from '../constants/labels';
import { totalCount } from './format';

/** Any row that carries a status → count map (queues, instances). */
export interface CountedRow {
  counts: Record<string, number>;
}

/** `Total` plus one column per counted status, in the shared order. */
export function countColumns<T extends CountedRow>(): TableColumn<T>[] {
  return [
    { title: 'Total', key: 'total', render: (r) => totalCount(r.counts) },
    ...COUNT_STATUSES.map((status): TableColumn<T> => ({
      title: STATUSES_CONFIG[status].label,
      key: status,
      render: (r) => r.counts[status] ?? 0,
    })),
  ];
}
