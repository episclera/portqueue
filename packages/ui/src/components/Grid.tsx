import React from 'react';
import styled from 'styled-components';

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

const StyledRow = styled.div<{ $gutter: number }>`
  display: flex;
  flex-wrap: wrap;
  row-gap: ${(p) => p.$gutter}px;
  margin-left: ${(p) => -p.$gutter / 2}px;
  margin-right: ${(p) => -p.$gutter / 2}px;
`;

/** Row of a simple 24-column flex grid. Sizes children by their `span`. */
export const Row = React.forwardRef<HTMLDivElement, RowProps>(function Row(
  { gutter = DEFAULT_GUTTER, children, ...rest },
  ref,
): React.ReactElement {
  return (
    <GutterContext.Provider value={gutter}>
      <StyledRow ref={ref} $gutter={gutter} {...rest}>
        {children}
      </StyledRow>
    </GutterContext.Provider>
  );
});

const clampSpan = (span: number): number => Math.min(24, Math.max(1, span));

const StyledCol = styled.div<{ $span?: number; $flex?: string; $gutter: number }>`
  box-sizing: border-box;
  min-width: 0;
  padding-left: ${(p) => p.$gutter / 2}px;
  padding-right: ${(p) => p.$gutter / 2}px;
  ${(p) =>
    p.$flex
      ? `flex: ${p.$flex};`
      : p.$span
        ? `flex: 0 0 ${(clampSpan(p.$span) / 24) * 100}%; max-width: ${(clampSpan(p.$span) / 24) * 100}%;`
        : 'flex: 1 1 0;'}
`;

/** Column of the 24-column grid. `span` (1..24) sets width; `flex` overrides it. */
export const Col = React.forwardRef<HTMLDivElement, ColProps>(function Col(
  { span, flex, children, ...rest },
  ref,
): React.ReactElement {
  const gutter = React.useContext(GutterContext);
  return (
    <StyledCol ref={ref} $span={span} $flex={flex} $gutter={gutter} {...rest}>
      {children}
    </StyledCol>
  );
});
