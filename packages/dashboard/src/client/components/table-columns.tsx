/**
 * What every dashboard table shares on top of antd's `Table`: the column builders, the props every
 * table renders with, and the row selection capped at the server's batch limit.
 */
import React from 'react';
import { Checkbox, Tooltip } from 'antd';
import type { TableColumnType, TableProps } from 'antd';
import type { TableRowSelection } from 'antd/es/table/interface';
import { COUNT_STATUSES, STATUSES_CONFIG } from '../constants/labels';
import { totalCount } from './format';
import { Time } from './Time';

/**
 * Props every table renders with. Pagination is off because the surrounding `TableCard` owns it (it
 * stays visible through the loading and error states, which replace the table); `max-content`
 * makes a table wider than its card scroll sideways rather than squeezing its columns.
 */
export const TABLE_PROPS = {
  pagination: false,
  size: 'middle',
  scroll: { x: 'max-content' },
} satisfies Partial<TableProps<object>>;

/** Any row that carries a status → count map (queues, instances). */
export interface CountedRow {
  counts: Record<string, number>;
}

/** `Total` plus one column per counted status, in the shared order. */
export function countColumns<T extends CountedRow>(): TableColumnType<T>[] {
  return [
    { title: 'Total', key: 'total', render: (_, r) => totalCount(r.counts) },
    ...COUNT_STATUSES.map((status): TableColumnType<T> => ({
      title: STATUSES_CONFIG[status].label,
      key: status,
      render: (_, r) => r.counts[status] ?? 0,
    })),
  ];
}

/**
 * Floor for every column that renders a `<Time>`. The instant — `12 Mar. 2026 13:23:01` — is a
 * single unbreakable fact: wrapped onto two lines it stops being readable at a glance. 170px holds
 * it on one line, with the timezone stacked beneath it, and a table that outgrows its card scrolls
 * sideways rather than shrinking these columns.
 */
export const DATE_COLUMN_MIN_WIDTH = 170;

/** A timestamp column — one format and one width, everywhere a date is tabulated. */
export function dateColumn<T>(
  title: string,
  key: string,
  value: (row: T) => string | null | undefined,
): TableColumnType<T> {
  const style = { minWidth: DATE_COLUMN_MIN_WIDTH };
  return {
    title,
    key,
    onHeaderCell: () => ({ style }),
    onCell: () => ({ style }),
    // Stacked: the instant is what a reader scans down the column; the offset is context.
    render: (_, row) => <Time value={value(row)} stacked />,
  };
}

/**
 * The trailing actions column: buttons hug the right edge, while the title stays on the left,
 * where it reads as this column's.
 */
export function actionsColumn<T>(render: (row: T) => React.ReactNode): TableColumnType<T> {
  return {
    title: 'Actions',
    key: 'actions',
    align: 'right',
    onHeaderCell: () => ({ style: { textAlign: 'left' } }),
    render: (_, row) => render(row),
  };
}

export interface CappedSelectionOptions<T> {
  /** The rows on screen. */
  rows: T[];
  keyOf: (row: T) => string;
  selected: string[];
  onChange: (keys: string[]) => void;
  /** The most rows one bulk action may carry — the server's batch cap. */
  max: number;
  /** Why a checkbox is refused, shown on hover. */
  hint: string;
}

/**
 * antd row selection that never grows past `max`. A bulk action is one statement, and the
 * smallest engine limit on the ids one statement can bind is everyone's limit; the server refuses
 * more too, and this is the same number, delivered with the page rather than copied into the
 * client.
 *
 * Once the cap is reached every unselected checkbox is disabled and says why on hover — only adding
 * is blocked, so a selected row can always be cleared. Select-all is refused up front when it would
 * pass the cap, rather than selecting an arbitrary prefix of the page.
 */
export function cappedRowSelection<T>({
  rows,
  keyOf,
  selected,
  onChange,
  max,
  hint,
}: CappedSelectionOptions<T>): TableRowSelection<T> {
  const visible = rows.map(keyOf);
  const chosen = new Set(selected);
  const atCap = selected.length >= max;
  const allSelected = visible.length > 0 && visible.every((key) => chosen.has(key));
  const someSelected = visible.some((key) => chosen.has(key));
  const refused = (row: T): boolean => atCap && !chosen.has(keyOf(row));

  return {
    selectedRowKeys: selected,
    onChange: (keys) => onChange(keys.map(String)),
    columnTitle: (
      <Checkbox
        aria-label="Select all rows"
        checked={allSelected}
        indeterminate={someSelected && !allSelected}
        disabled={!someSelected && visible.length > max}
        onChange={() => onChange(someSelected ? [] : visible)}
      />
    ),
    getCheckboxProps: (row) => ({
      disabled: refused(row),
      'aria-label': `Select row ${keyOf(row)}`,
    }),
    renderCell: (_checked, row, _index, node) =>
      refused(row) ? (
        <Tooltip title={hint}>
          <span>{node}</span>
        </Tooltip>
      ) : (
        node
      ),
  };
}
