import React from 'react';
import styled from 'styled-components';

export interface PaginationProps {
  /** 1-based current page. */
  page: number;
  /** Total number of rows across every page. */
  total: number;
  /** Rows per page. */
  pageSize: number;
  onChange: (page: number) => void;
  /** Accessible label for the nav landmark. */
  label?: string;
}

const Root = styled.nav`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: ${(p) => p.theme.space(1)};
  flex-wrap: wrap;
`;

const PageButton = styled.button<{ $active: boolean }>`
  min-width: 32px;
  height: 32px;
  padding: 0 ${(p) => p.theme.space(2)};
  font-family: inherit;
  font-size: 13px;
  font-weight: ${(p) => (p.$active ? 700 : 500)};
  color: ${(p) => (p.$active ? p.theme.color.onBrand : p.theme.color.text)};
  background: ${(p) => (p.$active ? p.theme.color.brandSolid : 'transparent')};
  border: 1px solid ${(p) => (p.$active ? p.theme.color.brandSolid : p.theme.color.border)};
  border-radius: ${(p) => p.theme.radii.md}px;
  cursor: pointer;
  transition:
    background ${(p) => p.theme.motion.fast},
    border-color ${(p) => p.theme.motion.fast};

  &:hover:not(:disabled) {
    border-color: ${(p) => (p.$active ? p.theme.color.brandSolid : p.theme.color.borderStrong)};
    background: ${(p) => (p.$active ? p.theme.color.brandSolid : p.theme.color.surfaceAlt)};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.brand};
    outline-offset: 2px;
  }
`;

const Gap = styled.span`
  min-width: 24px;
  text-align: center;
  color: ${(p) => p.theme.color.textFaint};
  font-size: 13px;
  user-select: none;
`;

/** Prev / next stay in place at the ends of the row and disable rather than disappear. */
const StepButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: ${(p) => p.theme.space(1)};
  height: 32px;
  padding: 0 ${(p) => p.theme.space(3)};
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  color: ${(p) => p.theme.color.text};
  background: transparent;
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radii.md}px;
  cursor: pointer;
  transition:
    background ${(p) => p.theme.motion.fast},
    border-color ${(p) => p.theme.motion.fast};

  &:hover:not(:disabled) {
    background: ${(p) => p.theme.color.surfaceAlt};
    border-color: ${(p) => p.theme.color.borderStrong};
  }

  &:disabled {
    color: ${(p) => p.theme.color.textFaint};
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.brand};
    outline-offset: 2px;
  }
`;

const ELLIPSIS = '…' as const;

/** How many numbers fit before the window needs ellipses. */
const MAX_PLAIN_PAGES = 7;

/**
 * The visible page tokens: the first and last page always, plus a three-page window around the
 * current one, with an ellipsis standing in for each skipped run (e.g. `1 … 4 5 6 … 9`).
 */
function pageItems(page: number, pageCount: number): (number | typeof ELLIPSIS)[] {
  if (pageCount <= MAX_PLAIN_PAGES) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const start = Math.min(Math.max(page - 1, 2), pageCount - 3);
  return [
    1,
    ...(start > 2 ? [ELLIPSIS] : []),
    start,
    start + 1,
    start + 2,
    ...(start + 2 < pageCount - 1 ? [ELLIPSIS] : []),
    pageCount,
  ];
}

/**
 * Minimal numbered pagination — page numbers flanked by prev / next steps (no page-size
 * selector). Always renders, even for a single page: the steps stay put and disable, so a
 * table's footer never shifts.
 */
export function Pagination({
  page,
  total,
  pageSize,
  onChange,
  label = 'Pagination',
}: PaginationProps): React.ReactElement {
  const pageCount = Math.max(Math.ceil(total / Math.max(pageSize, 1)), 1);
  const current = Math.min(Math.max(page, 1), pageCount);

  return (
    <Root aria-label={label}>
      <StepButton
        type="button"
        disabled={current <= 1}
        aria-label="Previous page"
        onClick={() => onChange(current - 1)}
      >
        <span aria-hidden>‹</span> Prev
      </StepButton>
      {pageItems(current, pageCount).map((item, index) =>
        item === ELLIPSIS ? (
          <Gap key={`gap-${index}`} aria-hidden>
            {ELLIPSIS}
          </Gap>
        ) : (
          <PageButton
            key={item}
            type="button"
            $active={item === current}
            aria-current={item === current ? 'page' : undefined}
            aria-label={`Page ${item}`}
            onClick={() => item !== current && onChange(item)}
          >
            {item}
          </PageButton>
        ),
      )}
      <StepButton
        type="button"
        disabled={current >= pageCount}
        aria-label="Next page"
        onClick={() => onChange(current + 1)}
      >
        Next <span aria-hidden>›</span>
      </StepButton>
    </Root>
  );
}
