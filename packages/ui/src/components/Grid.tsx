import React from 'react';
import clsx from 'clsx';
import styles from './Grid.module.css';

export interface RowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Horizontal + vertical gap between columns, in px. Defaults to 16. */
  gutter?: number;
}

export interface ColProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Column width as a fraction of 24. */
  span?: number;
  /** Explicit `flex` shorthand — overrides `span` when provided. */
  flex?: string;
}

const DEFAULT_GUTTER = 16;

/**
 * The row's gutter, read by its columns. The gap lives in the columns' own padding (with the
 * row pulling back half a gutter on each side), so spans summing to 24 still fit on one line —
 * a `gap` would push the last column onto the next row.
 */
const GutterContext = React.createContext(DEFAULT_GUTTER);

/** Row of a simple 24-column flex grid. Sizes children by their `span`. */
export const Row = React.forwardRef<HTMLDivElement, RowProps>(function Row(
  { gutter = DEFAULT_GUTTER, className, style, children, ...rest },
  ref,
): React.ReactElement {
  return (
    <GutterContext.Provider value={gutter}>
      <div
        ref={ref}
        className={clsx(styles.row, className)}
        style={{ '--pq-grid-gutter': `${gutter}px`, ...style } as React.CSSProperties}
        {...rest}
      >
        {children}
      </div>
    </GutterContext.Provider>
  );
});

const clampSpan = (span: number): number => Math.min(24, Math.max(1, span));

/** Column of the 24-column grid. `span` (1..24) sets width; `flex` overrides it. */
export const Col = React.forwardRef<HTMLDivElement, ColProps>(function Col(
  { span, flex, className, style, children, ...rest },
  ref,
): React.ReactElement {
  const gutter = React.useContext(GutterContext);
  const width = span ? `${(clampSpan(span) / 24) * 100}%` : undefined;
  const sizing: React.CSSProperties = flex
    ? { flex }
    : width
      ? { flex: `0 0 ${width}`, maxWidth: width }
      : {};
  return (
    <div
      ref={ref}
      className={clsx(styles.col, className)}
      style={{ '--pq-grid-gutter': `${gutter}px`, ...sizing, ...style } as React.CSSProperties}
      {...rest}
    >
      {children}
    </div>
  );
});
