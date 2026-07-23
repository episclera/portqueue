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

const StyledRow = styled.div<{ $gutter: number }>`
  display: flex;
  flex-wrap: wrap;
  gap: ${(p) => p.$gutter}px;
`;

/** Row of a simple 24-column flex grid. Sizes children by their `span`. */
export const Row = React.forwardRef<HTMLDivElement, RowProps>(function Row(
  { gutter = 16, children, ...rest },
  ref,
): React.ReactElement {
  return (
    <StyledRow ref={ref} $gutter={gutter} {...rest}>
      {children}
    </StyledRow>
  );
});

const clampSpan = (span: number): number => Math.min(24, Math.max(1, span));

const StyledCol = styled.div<{ $span?: number; $flex?: string }>`
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
  return (
    <StyledCol ref={ref} $span={span} $flex={flex} {...rest}>
      {children}
    </StyledCol>
  );
});
