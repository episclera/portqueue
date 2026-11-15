/**
 * The frame every table on the dashboard sits in: an antd `Card` whose header carries the result
 * count on the left and the table's controls on the right (bulk actions, Filters, search). A second
 * row lists the applied filters as closable tags, so which filters are on is visible without
 * opening the dialog. The footer always shows the numbered pagination — even for a single page — so
 * the card never changes height.
 *
 * The card owns three mutually exclusive body states: a skeleton on first load, an error notice when
 * the query failed, and the table itself. A failure replaces the table rather than sitting above
 * stale rows — a stale row read as a current one is worse than no row at all.
 */
import React, { useRef, useState } from 'react';
import { Button, Card, Flex, Pagination, Skeleton, theme } from 'antd';
import { ToneTag } from './StateTags';
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
  /** First-load flag — renders a skeleton in place of the table. */
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
    /** Remove a single applied value — what a tag's close button does. */
    onClear: (key: string, value: string) => void;
  };
  /** Leading control on the header's right side — e.g. the bulk-actions button. */
  toolbarLeading?: React.ReactNode;
  children: React.ReactNode;
}

const countFilters = (values: Record<string, string[] | undefined>): number =>
  Object.values(values).reduce((n, list) => n + (list?.length ?? 0), 0);

/** Every applied filter, flattened to one tag per value with its human labels resolved. */
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
  children,
}: TableCardProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { token } = theme.useToken();
  const activeFilters = filters ? countFilters(filters.values) : 0;
  const chips = filters ? appliedChips(filters.defs, filters.values) : [];
  const padded = { padding: `${token.paddingSM}px ${token.padding}px` };

  // Turning the page scrolls the table's own top into view, not the whole document.
  const goToPage = (next: number): void => {
    onPageChange(next);
    rootRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Card
      ref={rootRef}
      title={`Results (${total})`}
      extra={
        <Flex gap="small" align="center" wrap>
          {toolbarLeading}
          {filters ? (
            <Button icon={ACTIONS_CONFIG.filters.icon} onClick={() => setFiltersOpen(true)}>
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
        </Flex>
      }
      styles={{ body: { padding: 0 }, header: { flexWrap: 'wrap', gap: token.marginSM } }}
    >
      {chips.length > 0 && filters ? (
        <Flex
          gap="small"
          wrap
          align="center"
          style={{ ...padded, borderBottom: `1px solid ${token.colorBorderSecondary}` }}
        >
          {chips.map((chip) => (
            <ToneTag
              key={`${chip.key}:${chip.value}`}
              closable={{ 'aria-label': `Remove the ${chip.label} filter ${chip.valueLabel}` }}
              onClose={(e) => {
                e.preventDefault();
                filters.onClear(chip.key, chip.value);
              }}
            >
              {chip.label}: <strong>{chip.valueLabel}</strong>
            </ToneTag>
          ))}
        </Flex>
      ) : null}

      {error ? (
        <div style={{ padding: token.padding }}>
          <ErrorState title={errorTitle} error={error} {...(onRetry ? { onRetry } : {})} />
        </div>
      ) : loading ? (
        <div style={{ padding: token.padding }}>
          <Skeleton active title={false} paragraph={{ rows: 6 }} />
        </div>
      ) : (
        children
      )}

      <Flex
        justify="center"
        style={{ ...padded, borderTop: `1px solid ${token.colorBorderSecondary}` }}
      >
        <Pagination
          current={page}
          total={total}
          pageSize={PAGE_SIZE}
          showSizeChanger={false}
          onChange={goToPage}
        />
      </Flex>

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
