import React from 'react';
import styled, { css } from 'styled-components';

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gap between children, in 4px spacing units → `space(gap)`. */
  gap?: number;
  align?: React.CSSProperties['alignItems'];
}

export interface InlineProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gap between children, in 4px spacing units → `space(gap)`. */
  gap?: number;
  align?: React.CSSProperties['alignItems'];
  justify?: React.CSSProperties['justifyContent'];
  wrap?: boolean;
}

const StyledStack = styled.div<{ $gap: number; $align?: React.CSSProperties['alignItems'] }>`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space(p.$gap)};
  ${(p) =>
    p.$align &&
    css`
      align-items: ${p.$align};
    `}
`;

/** Vertical flex stack — children flow top-to-bottom with a spacing-scale gap. */
export const Stack = React.forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap = 0, align, children, ...rest },
  ref,
): React.ReactElement {
  return (
    <StyledStack ref={ref} $gap={gap} $align={align} {...rest}>
      {children}
    </StyledStack>
  );
});

const StyledInline = styled.div<{
  $gap: number;
  $align?: React.CSSProperties['alignItems'];
  $justify?: React.CSSProperties['justifyContent'];
  $wrap: boolean;
}>`
  display: flex;
  flex-direction: row;
  gap: ${(p) => p.theme.space(p.$gap)};
  flex-wrap: ${(p) => (p.$wrap ? 'wrap' : 'nowrap')};
  ${(p) =>
    p.$align &&
    css`
      align-items: ${p.$align};
    `}
  ${(p) =>
    p.$justify &&
    css`
      justify-content: ${p.$justify};
    `}
`;

/** Horizontal flex row — children flow left-to-right with a spacing-scale gap. */
export const Inline = React.forwardRef<HTMLDivElement, InlineProps>(function Inline(
  { gap = 0, align, justify, wrap = false, children, ...rest },
  ref,
): React.ReactElement {
  return (
    <StyledInline ref={ref} $gap={gap} $align={align} $justify={justify} $wrap={wrap} {...rest}>
      {children}
    </StyledInline>
  );
});
