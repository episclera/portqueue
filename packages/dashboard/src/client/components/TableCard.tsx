/**
 * The frame every table on the dashboard sits in. The top row carries the result count on the
 * left and the table's controls on the right (bulk actions, Filters, search); a second row lists
 * the applied filters as dismissible chips, so which filters are on is visible without opening
 * the dialog. The table spans the card's full width, and the footer always shows the numbered
 * pagination — even for a single page — so the card never changes height.
 *
 * The card owns three mutually exclusive body states: skeleton rows on first load, an error
 * notice when the query failed, and the table itself. A failure replaces the table rather than
 * sitting above stale rows — a stale row read as a current one is worse than no row at all.
 */
import React, { useRef, useState } from 'react';
import styled from 'styled-components';
import { Button, Card, CloseIcon, Pagination, ScrollShadow, SkeletonText } from '@portqueue/ui';
import { ACTIONS_CONFIG } from '../constants/labels';
import { PAGE_SIZE } from '../queries/use-table-params';
import { SearchInput } from './SearchInput';
import { ErrorState } from './states';
import { FiltersModal, type FilterDef } from './FiltersModal';

export interface TableCardProps {
  /** Total rows matching the query across every page (not just the visible one). */
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  /** First-load flag — renders skeleton rows in place of the table. */
  loading?: boolean;
  /** Set when the query failed; renders the error notice instead of the table. */
  error?: unknown;
  /** What the error notice is titled, e.g. "Couldn't load queues". */
  errorTitle?: string;
  onRetry?: () => void;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  };
  filters?: {
    defs: FilterDef[];
    values: Record<string, string[] | undefined>;
    onChange: (values: Record<string, string[]>) => void;
    /** Remove a single applied value — what a chip's close button does. */
    onClear: (key: string, value: string) => void;
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

/** The chips row, directly under the result count. Only rendered when a filter is applied. */
const ChipBar = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(2)};
  flex-wrap: wrap;
  padding: ${(p) => p.theme.space(2)} ${(p) => p.theme.space(4)};
  border-bottom: 1px solid ${(p) => p.theme.color.border};
`;

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${(p) => p.theme.space(2)};
  padding: 2px 4px 2px 10px;
  font-size: 12.5px;
  color: ${(p) => p.theme.color.text};
  background: ${(p) => p.theme.color.surfaceAlt};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: 999px;
`;

const ChipLabel = styled.span`
  color: ${(p) => p.theme.color.textMuted};
`;

const ChipClear = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  font-size: 10px;
  line-height: 1;
  color: ${(p) => p.theme.color.textMuted};
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;

  &:hover {
    color: ${(p) => p.theme.color.text};
    background: ${(p) => p.theme.color.border};
  }
`;

const Footer = styled.div`
  padding: ${(p) => p.theme.space(3)} ${(p) => p.theme.space(4)};
  border-top: 1px solid ${(p) => p.theme.color.border};
`;

const Padded = styled.div`
  padding: ${(p) => p.theme.space(4)};
`;

const countFilters = (values: Record<string, string[] | undefined>): number =>
  Object.values(values).reduce((n, list) => n + (list?.length ?? 0), 0);

/** Every applied filter, flattened to one chip per value with its human labels resolved. */
function appliedChips(
  defs: FilterDef[],
  values: Record<string, string[] | undefined>,
): { key: string; value: string; label: string; valueLabel: string }[] {
  const out: { key: string; value: string; label: string; valueLabel: string }[] = [];
  for (const def of defs) {
    for (const value of values[def.key] ?? []) {
      const option = def.options.find((o) => o.value === value);
      out.push({ key: def.key, value, label: def.label, valueLabel: option?.label ?? value });
    }
  }
  return out;
}

export function TableCard({
  total,
  page,
  onPageChange,
  loading = false,
  error,
  errorTitle = 'Could not load this table',
  onRetry,
  search,
  filters,
  toolbarLeading,
  paginationLabel = 'Pagination',
  children,
}: TableCardProps): React.ReactElement {
  const rootRef = useRef<HTMLElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = filters ? countFilters(filters.values) : 0;
  const chips = filters ? appliedChips(filters.defs, filters.values) : [];

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

      {chips.length > 0 && filters ? (
        <ChipBar>
          {chips.map((chip) => (
            <Chip key={`${chip.key}:${chip.value}`}>
              <span>
                <ChipLabel>{chip.label}:</ChipLabel> {chip.valueLabel}
              </span>
              <ChipClear
                type="button"
                aria-label={`Remove the ${chip.label} filter ${chip.valueLabel}`}
                onClick={() => filters.onClear(chip.key, chip.value)}
              >
                <CloseIcon aria-hidden />
              </ChipClear>
            </Chip>
          ))}
        </ChipBar>
      ) : null}

      {error ? (
        <Padded>
          <ErrorState title={errorTitle} error={error} {...(onRetry ? { onRetry } : {})} />
        </Padded>
      ) : loading ? (
        <Padded>
          <SkeletonText rows={6} />
        </Padded>
      ) : (
        // Tables run edge to edge; the fades mark a table wider than the card as scrollable.
        <ScrollShadow>{children}</ScrollShadow>
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
