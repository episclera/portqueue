/**
 * The frame every table on the dashboard sits in. No card title: the top row carries the
 * result count on the left and the table's controls on the right (bulk actions, Filters,
 * search). The table itself spans the card's full width, and the footer always shows the
 * numbered pagination — even for a single page — so the card never changes height.
 *
 * While the first load is in flight it renders skeleton rows instead of a spinner.
 */
import React, { useRef, useState } from 'react';
import styled from 'styled-components';
import { Button, Card, Pagination, SkeletonText } from '@portqueue/ui';
import { ACTIONS_CONFIG } from '../constants/labels';
import { PAGE_SIZE } from '../queries/use-table-params';
import { SearchInput } from './SearchInput';
import { FiltersModal, type FilterDef } from './FiltersModal';

export interface TableCardProps {
  /** Total rows matching the query across every page (not just the visible one). */
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  /** First-load flag — renders skeleton rows in place of the table. */
  loading?: boolean;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  };
  filters?: {
    defs: FilterDef[];
    values: Record<string, string[] | undefined>;
    onChange: (values: Record<string, string[]>) => void;
  };
  /** Leading control on the toolbar's right side — e.g. the bulk-actions button. */
  toolbarLeading?: React.ReactNode;
  /** Label for the pagination landmark, e.g. "Jobs pagination". */
  paginationLabel?: string;
  children: React.ReactNode;
}

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${(p) => p.theme.space(3)};
  flex-wrap: wrap;
  padding: ${(p) => p.theme.space(3)} ${(p) => p.theme.space(4)};
  border-bottom: 1px solid ${(p) => p.theme.color.border};
`;

const Results = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: ${(p) => p.theme.color.text};
`;

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(2)};
  flex-wrap: wrap;
`;

/** Tables run edge to edge; only the horizontal overflow is scrollable. */
const TableScroll = styled.div`
  width: 100%;
  overflow-x: auto;
`;

const Footer = styled.div`
  padding: ${(p) => p.theme.space(3)} ${(p) => p.theme.space(4)};
  border-top: 1px solid ${(p) => p.theme.color.border};
`;

const SkeletonArea = styled.div`
  padding: ${(p) => p.theme.space(4)};
`;

const countFilters = (values: Record<string, string[] | undefined>): number =>
  Object.values(values).reduce((n, list) => n + (list?.length ?? 0), 0);

export function TableCard({
  total,
  page,
  onPageChange,
  loading = false,
  search,
  filters,
  toolbarLeading,
  paginationLabel = 'Pagination',
  children,
}: TableCardProps): React.ReactElement {
  const rootRef = useRef<HTMLElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = filters ? countFilters(filters.values) : 0;

  // Turning the page scrolls the table's own top into view, not the whole document.
  const goToPage = (next: number): void => {
    onPageChange(next);
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Card ref={rootRef} bodyPadding={false}>
      <Toolbar>
        <Results>Results ({total})</Results>
        <Controls>
          {toolbarLeading}
          {filters ? (
            <Button
              size="sm"
              icon={ACTIONS_CONFIG.filters.icon}
              onClick={() => setFiltersOpen(true)}
            >
              {ACTIONS_CONFIG.filters.label}
              {activeFilters > 0 ? ` (${activeFilters})` : ''}
            </Button>
          ) : null}
          {search ? (
            <SearchInput
              value={search.value}
              onChange={search.onChange}
              placeholder={search.placeholder}
            />
          ) : null}
        </Controls>
      </Toolbar>

      {loading ? (
        <SkeletonArea>
          <SkeletonText rows={6} />
        </SkeletonArea>
      ) : (
        <TableScroll>{children}</TableScroll>
      )}

      <Footer>
        <Pagination
          page={page}
          total={total}
          pageSize={PAGE_SIZE}
          onChange={goToPage}
          label={paginationLabel}
        />
      </Footer>

      {filters ? (
        <FiltersModal
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          defs={filters.defs}
          values={filters.values}
          onApply={filters.onChange}
        />
      ) : null}
    </Card>
  );
}
