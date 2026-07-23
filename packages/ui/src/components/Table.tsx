import React from 'react';
import styled, { css } from 'styled-components';

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

export interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  empty?: React.ReactNode;
  size?: TableSize;
  onRowClick?: (row: T) => void;
}

const cellPad = (size: TableSize): ReturnType<typeof css> =>
  size === 'sm'
    ? css`
        padding: ${(p) => p.theme.space(1)} ${(p) => p.theme.space(2)};
      `
    : css`
        padding: ${(p) => p.theme.space(2)} ${(p) => p.theme.space(3)};
      `;

const StyledTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  color: ${(p) => p.theme.color.text};
  font-family: inherit;
`;

const Th = styled.th<{ $align: TableAlign; $size: TableSize }>`
  ${(p) => cellPad(p.$size)}
  text-align: ${(p) => p.$align};
  background: ${(p) => p.theme.color.surfaceAlt};
  color: ${(p) => p.theme.color.textMuted};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
  border-bottom: 1px solid ${(p) => p.theme.color.border};
`;

const Tr = styled.tr<{ $clickable: boolean }>`
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  transition: background ${(p) => p.theme.motion.fast};
  &:hover {
    background: ${(p) => p.theme.color.surfaceAlt};
  }
`;

const Td = styled.td<{ $align: TableAlign; $size: TableSize }>`
  ${(p) => cellPad(p.$size)}
  text-align: ${(p) => p.$align};
  border-bottom: 1px solid ${(p) => p.theme.color.border};
`;

const EmptyCell = styled.td<{ $size: TableSize }>`
  ${(p) => cellPad(p.$size)}
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

/** Bespoke generic data table — column-driven, with optional row click, sizes and empty state. */
export function Table<T>({
  columns,
  data,
  rowKey,
  empty,
  size = 'md',
  onRowClick,
}: TableProps<T>): React.ReactElement {
  const emptyNode = empty ?? (
    <>
      <span aria-hidden>📭</span> No data
    </>
  );
  return (
    <StyledTable>
      <thead>
        <tr>
          {columns.map((column) => (
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
            <EmptyCell $size={size} colSpan={Math.max(columns.length, 1)}>
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
              {columns.map((column) => (
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
