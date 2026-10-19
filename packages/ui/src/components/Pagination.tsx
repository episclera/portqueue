import React from 'react';
import clsx from 'clsx';
import styles from './Pagination.module.css';

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
  className?: string;
  style?: React.CSSProperties;
}

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
  className,
  style,
}: PaginationProps): React.ReactElement {
  const pageCount = Math.max(Math.ceil(total / Math.max(pageSize, 1)), 1);
  const current = Math.min(Math.max(page, 1), pageCount);

  return (
    <nav className={clsx(styles.root, className)} style={style} aria-label={label}>
      <button
        className={styles.step}
        type="button"
        disabled={current <= 1}
        aria-label="Previous page"
        onClick={() => onChange(current - 1)}
      >
        <span aria-hidden>‹</span> Prev
      </button>
      {pageItems(current, pageCount).map((item, index) =>
        item === ELLIPSIS ? (
          <span key={`gap-${index}`} className={styles.gap} aria-hidden>
            {ELLIPSIS}
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className={clsx(styles.page, item === current && styles.active)}
            aria-current={item === current ? 'page' : undefined}
            aria-label={`Page ${item}`}
            onClick={() => item !== current && onChange(item)}
          >
            {item}
          </button>
        ),
      )}
      <button
        className={styles.step}
        type="button"
        disabled={current >= pageCount}
        aria-label="Next page"
        onClick={() => onChange(current + 1)}
      >
        Next <span aria-hidden>›</span>
      </button>
    </nav>
  );
}
