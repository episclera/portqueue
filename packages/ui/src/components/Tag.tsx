import React from 'react';
import styled, { css } from 'styled-components';
import type { DefaultTheme } from 'styled-components';

export type TagVariant = 'soft' | 'outline' | 'solid';
export type TagTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic tone resolved from the palette. Ignored when `color` is set. */
  tone?: TagTone;
  /** Explicit CSS colour override; prefer `tone` so tags stay on-palette. */
  color?: string;
  variant?: TagVariant;
  /** Fully rounded pill shape. */
  pill?: boolean;
}

/** Resolve a tag's colour: explicit `$color` wins, otherwise map the tone to a palette token. */
function tagColor(p: { $color?: string; $tone: TagTone; theme: DefaultTheme }): string {
  if (p.$color) return p.$color;
  switch (p.$tone) {
    case 'success':
      return p.theme.color.status.COMPLETED;
    case 'warning':
      return p.theme.color.warningHover;
    case 'danger':
      return p.theme.color.dangerHover;
    case 'info':
      return p.theme.color.status.ACTIVE;
    default:
      return p.theme.color.status.PENDING;
  }
}

/**
 * Every tag is bordered, and the border always matches the text inside it — so a chip reads as
 * one colour whatever its variant.
 */
const Root = styled.span<{ $color?: string; $tone: TagTone; $variant: TagVariant; $pill: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  padding: 4px 10px;
  border-radius: ${(p) => (p.$pill ? '999px' : `${p.theme.radii.sm}px`)};
  border: 1px solid currentColor;
  white-space: nowrap;
  ${(p) =>
    p.$variant === 'solid'
      ? css`
          background: ${tagColor(p)};
          color: ${p.theme.color.onBrand};
        `
      : p.$variant === 'outline'
        ? css`
            color: ${tagColor(p)};
            background: transparent;
          `
        : css`
            color: ${tagColor(p)};
            background: ${tagColor(p)}1f;
          `}
`;

/** Compact label chip. `tone` picks a palette colour; `variant` controls soft/outline/solid. */
export function Tag({
  tone = 'neutral',
  color,
  variant = 'soft',
  pill = false,
  children,
  ...rest
}: TagProps): React.ReactElement {
  return (
    <Root $tone={tone} $color={color} $variant={variant} $pill={pill} {...rest}>
      {children}
    </Root>
  );
}
