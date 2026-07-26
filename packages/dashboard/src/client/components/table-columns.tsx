/** Column builders shared by the dashboard's tables. */
import React from 'react';
import type { TableColumn } from '@portqueue/ui';
import { COUNT_STATUSES, STATUSES_CONFIG } from '../constants/labels';
import { totalCount } from './format';
import { Time } from './Time';

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

/**
 * Floor for every column that renders a `<Time>`. The one timestamp format —
 * `12 Mar. 2026 13:23:01 UTC+2` — is a single unbreakable fact: wrapped onto two lines, or squeezed
 * until the offset drops off, it stops being readable at a glance. 220px fits the longest form, and
 * a table that outgrows its card scrolls sideways rather than shrinking these columns.
 */
export const DATE_COLUMN_MIN_WIDTH = 220;

/** A timestamp column — one format and one width, everywhere a date is tabulated. */
export function dateColumn<T>(
  title: string,
  key: string,
  value: (row: T) => string | null | undefined,
): TableColumn<T> {
  return {
    title,
    key,
    minWidth: DATE_COLUMN_MIN_WIDTH,
    render: (row) => <Time value={value(row)} />,
  };
}
