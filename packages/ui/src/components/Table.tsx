import React from 'react';
import clsx from 'clsx';
import { Checkbox } from './Checkbox';
import { Tooltip } from './Tooltip';
import { EmptyIcon } from '../icons';
import styles from './Table.module.css';

export type TableAlign = 'left' | 'right' | 'center';
export type TableSize = 'sm' | 'md';

export interface TableColumn<T> {
  key: string;
  title: React.ReactNode;
  render?: (row: T, index: number) => React.ReactNode;
  dataIndex?: keyof T;
  width?: number | string;
  /**
   * Floor for the column's width, applied to the header and every body cell. `width` alone is a
   * suggestion the auto layout may shrink; a floor holds even in a narrow card — the table grows
   * past the card and the horizontal scroller takes over. Used by columns whose content must not
   * wrap, e.g. a full timestamp.
   */
  minWidth?: number | string;
  align?: TableAlign;
  /**
   * Alignment for the header cell alone, when it should differ from the body. An actions column
   * pins its buttons to the right edge, but a title pushed out there reads as belonging to the
   * column after it — so it keeps its label on the left.
   */
  headerAlign?: TableAlign;
}

/** Row-selection wiring — renders a leading checkbox column with a select-all header. */
export interface TableRowSelection {
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
  /**
   * Ceiling on how many rows may be selected at once. At the ceiling, every unselected checkbox
   * (and select-all) is disabled and says why — clearing one frees a slot. This exists because a
   * bulk action is one statement over the whole set, and every engine has a limit on how many ids
   * one statement can bind; the smallest of them is the limit for all of them.
   */
  maxSelected?: number;
  /** Tooltip shown on a checkbox disabled by {@link maxSelected}. */
  maxSelectedHint?: string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  empty?: React.ReactNode;
  size?: TableSize;
  onRowClick?: (row: T) => void;
  rowSelection?: TableRowSelection;
  className?: string;
  style?: React.CSSProperties;
}

const sizeToPx = (v: number | string | undefined): string | undefined =>
  v === undefined ? undefined : typeof v === 'number' ? `${v}px` : v;

/** The width constraints a column puts on both its header and its body cells. */
const cellSizing = <T,>(column: TableColumn<T>): React.CSSProperties => ({
  ...(column.width === undefined ? {} : { width: sizeToPx(column.width) }),
  ...(column.minWidth === undefined ? {} : { minWidth: sizeToPx(column.minWidth) }),
});

const cellContent = <T,>(column: TableColumn<T>, row: T, index: number): React.ReactNode => {
  if (column.render) return column.render(row, index);
  if (column.dataIndex !== undefined) return String(row[column.dataIndex]);
  return null;
};

/** Prepend the checkbox column when `rowSelection` is given. */
function withSelectionColumn<T>(
  columns: TableColumn<T>[],
  data: T[],
  rowKey: (row: T) => string,
  selection: TableRowSelection,
): TableColumn<T>[] {
  const pageKeys = data.map(rowKey);
  const allSelected =
    pageKeys.length > 0 && pageKeys.every((k) => selection.selectedKeys.includes(k));
  const max = selection.maxSelected;
  const hint = selection.maxSelectedHint ?? `Selection is limited to ${String(max)} rows.`;
  const atCeiling = max !== undefined && selection.selectedKeys.length >= max;
  // Selecting the rest of this page would pass the ceiling, so the header checkbox is refused too
  // rather than silently selecting a prefix.
  const allWouldExceed =
    max !== undefined &&
    new Set([...selection.selectedKeys, ...pageKeys]).size > max &&
    !allSelected;

  const toggleAll = (): void => {
    selection.onChange(
      allSelected
        ? selection.selectedKeys.filter((k) => !pageKeys.includes(k))
        : [...new Set([...selection.selectedKeys, ...pageKeys])],
    );
  };

  const toggleRow = (key: string): void => {
    selection.onChange(
      selection.selectedKeys.includes(key)
        ? selection.selectedKeys.filter((k) => k !== key)
        : [...selection.selectedKeys, key],
    );
  };

  const selectColumn: TableColumn<T> = {
    key: '__select',
    width: 44,
    title: maybeHinted(
      <Checkbox
        checked={allSelected}
        disabled={pageKeys.length === 0 || allWouldExceed}
        onChange={toggleAll}
        aria-label={allSelected ? 'Clear selection' : 'Select all rows'}
      />,
      allWouldExceed ? hint : undefined,
    ),
    render: (row) => {
      const key = rowKey(row);
      const checked = selection.selectedKeys.includes(key);
      // Only *adding* is blocked: an operator at the ceiling must still be able to deselect.
      const blocked = atCeiling && !checked;
      return maybeHinted(
        <Checkbox
          checked={checked}
          disabled={blocked}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleRow(key)}
          aria-label={`Select row ${key}`}
        />,
        blocked ? hint : undefined,
      );
    },
  };
  return [selectColumn, ...columns];
}

/** Wrap a node in a tooltip only when there is something to explain. */
function maybeHinted(node: React.ReactElement, hint: string | undefined): React.ReactNode {
  if (!hint) return node;
  return (
    <Tooltip title={hint} placement="bottom">
      <span>{node}</span>
    </Tooltip>
  );
}

/** Bespoke generic data table — column-driven, with optional row click, selection and empty state. */
export function Table<T>({
  columns,
  data,
  rowKey,
  empty,
  size = 'md',
  onRowClick,
  rowSelection,
  className,
  style,
}: TableProps<T>): React.ReactElement {
  const emptyNode = empty ?? (
    <>
      <div className={styles.emptyGlyph} aria-hidden>
        <EmptyIcon />
      </div>
      No data
    </>
  );
  const allColumns = rowSelection
    ? withSelectionColumn(columns, data, rowKey, rowSelection)
    : columns;
  return (
    <table className={clsx(styles.table, className)} style={style}>
      <thead>
        <tr>
          {allColumns.map((column) => (
            <th
              key={column.key}
              className={clsx(
                styles.th,
                styles[column.headerAlign ?? column.align ?? 'left'],
                size === 'sm' && styles.sm,
              )}
              style={cellSizing(column)}
            >
              {column.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.length === 0 ? (
          <tr>
            <td
              className={clsx(styles.td, size === 'sm' && styles.sm, styles.empty)}
              colSpan={Math.max(allColumns.length, 1)}
            >
              {emptyNode}
            </td>
          </tr>
        ) : (
          data.map((row, index) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? styles.clickable : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {allColumns.map((column) => (
                <td
                  key={column.key}
                  className={clsx(
                    styles.td,
                    styles[column.align ?? 'left'],
                    size === 'sm' && styles.sm,
                  )}
                  style={cellSizing(column)}
                >
                  {cellContent(column, row, index)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
