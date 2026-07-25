import React from 'react';
import styled, { css } from 'styled-components';
import { Checkbox } from './Checkbox';

export type TableAlign = 'left' | 'right' | 'center';
export type TableSize = 'sm' | 'md';

export interface TableColumn<T> {
  key: string;
  title: React.ReactNode;
  render?: (row: T, index: number) => React.ReactNode;
  dataIndex?: keyof T;
  width?: number | string;
  align?: TableAlign;
}

/** Row-selection wiring — renders a leading checkbox column with a select-all header. */
export interface TableRowSelection {
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  empty?: React.ReactNode;
  size?: TableSize;
  onRowClick?: (row: T) => void;
  rowSelection?: TableRowSelection;
}

/** Body-cell padding — compact, so rows stay dense. */
const cellPad = (size: TableSize): ReturnType<typeof css> =>
  size === 'sm'
    ? css`
        padding: ${(p) => p.theme.space(1)} ${(p) => p.theme.space(2)};
      `
    : css`
        padding: ${(p) => p.theme.space(2)} ${(p) => p.theme.space(3)};
      `;

/**
 * Header-cell padding — deliberately airier than the body on the Y axis, while matching its
 * horizontal padding so header labels stay aligned with the cells below them.
 */
const headerPad = (size: TableSize): ReturnType<typeof css> =>
  size === 'sm'
    ? css`
        padding: ${(p) => p.theme.space(3)} ${(p) => p.theme.space(2)};
      `
    : css`
        padding: ${(p) => p.theme.space(4)} ${(p) => p.theme.space(3)};
      `;

const StyledTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  color: ${(p) => p.theme.color.text};
  font-family: inherit;
`;

/**
 * Header cell — transparent (no fill band), roomier on the Y axis than the body rows, and the
 * only place with vertical dividers. Titles keep their given casing.
 */
const Th = styled.th<{ $align: TableAlign; $size: TableSize }>`
  ${(p) => headerPad(p.$size)}
  text-align: ${(p) => p.$align};
  background: transparent;
  color: ${(p) => p.theme.color.textMuted};
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
  white-space: nowrap;
  border-bottom: 1px solid ${(p) => p.theme.color.border};
  border-right: 1px solid ${(p) => p.theme.color.border};
  &:last-child {
    border-right: none;
  }
`;

/** Rows are static — no hover tint, so a dense table doesn't flicker under the cursor. */
const Tr = styled.tr<{ $clickable: boolean }>`
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
`;

/** Body cell — compact, and divided from the next row only (no vertical rules). */
const Td = styled.td<{ $align: TableAlign; $size: TableSize }>`
  ${(p) => cellPad(p.$size)}
  text-align: ${(p) => p.$align};
  border-bottom: 1px solid ${(p) => p.theme.color.border};
`;

/** Empty state — given real breathing room so a blank table doesn't read as a broken one. */
const EmptyCell = styled.td<{ $size: TableSize }>`
  ${(p) => cellPad(p.$size)}
  padding-top: 56px;
  padding-bottom: 56px;
  text-align: center;
  color: ${(p) => p.theme.color.textFaint};
  border-bottom: 1px solid ${(p) => p.theme.color.border};
`;

const sizeToPx = (v: number | string | undefined): string | undefined =>
  v === undefined ? undefined : typeof v === 'number' ? `${v}px` : v;

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
    title: (
      <Checkbox
        checked={allSelected}
        disabled={pageKeys.length === 0}
        onChange={toggleAll}
        aria-label={allSelected ? 'Clear selection' : 'Select all rows'}
      />
    ),
    render: (row) => {
      const key = rowKey(row);
      return (
        <Checkbox
          checked={selection.selectedKeys.includes(key)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleRow(key)}
          aria-label={`Select row ${key}`}
        />
      );
    },
  };
  return [selectColumn, ...columns];
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
}: TableProps<T>): React.ReactElement {
  const emptyNode = empty ?? (
    <>
      <span aria-hidden>📭</span> No data
    </>
  );
  const allColumns = rowSelection
    ? withSelectionColumn(columns, data, rowKey, rowSelection)
    : columns;
  return (
    <StyledTable>
      <thead>
        <tr>
          {allColumns.map((column) => (
            <Th
              key={column.key}
              $align={column.align ?? 'left'}
              $size={size}
              style={{ width: sizeToPx(column.width) }}
            >
              {column.title}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.length === 0 ? (
          <tr>
            <EmptyCell $size={size} colSpan={Math.max(allColumns.length, 1)}>
              {emptyNode}
            </EmptyCell>
          </tr>
        ) : (
          data.map((row, index) => (
            <Tr
              key={rowKey(row)}
              $clickable={Boolean(onRowClick)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {allColumns.map((column) => (
                <Td key={column.key} $align={column.align ?? 'left'} $size={size}>
                  {cellContent(column, row, index)}
                </Td>
              ))}
            </Tr>
          ))
        )}
      </tbody>
    </StyledTable>
  );
}
