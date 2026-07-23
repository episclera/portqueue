import React from 'react';
import styled, { css } from 'styled-components';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger' | 'text';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    Pick<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  /** Leading content — typically an emoji icon. */
  icon?: React.ReactNode;
}

const SIZES: Record<ButtonSize, { h: number; px: number; fs: number }> = {
  sm: { h: 30, px: 12, fs: 13 },
  md: { h: 38, px: 16, fs: 14 },
  lg: { h: 46, px: 22, fs: 16 },
};

const variantStyles = (v: ButtonVariant) =>
  ({
    primary: css`
      background: ${(p) => p.theme.color.brandSolid};
      color: ${(p) => p.theme.color.onBrand};
      border-color: ${(p) => p.theme.color.brandSolid};
      &:hover:not(:disabled) {
        background: ${(p) => p.theme.color.brandSolidHover};
        border-color: ${(p) => p.theme.color.brandSolidHover};
      }
    `,
    default: css`
      background: ${(p) => p.theme.color.surface};
      color: ${(p) => p.theme.color.text};
      border-color: ${(p) => p.theme.color.borderStrong};
      &:hover:not(:disabled) {
        color: ${(p) => p.theme.color.link};
        border-color: ${(p) => p.theme.color.link};
      }
    `,
    ghost: css`
      background: transparent;
      color: ${(p) => p.theme.color.brand};
      border-color: ${(p) => p.theme.color.brand};
      &:hover:not(:disabled) {
        background: ${(p) => p.theme.color.brand}14;
      }
    `,
    danger: css`
      background: ${(p) => p.theme.color.danger};
      color: ${(p) => p.theme.color.onBrand};
      border-color: ${(p) => p.theme.color.danger};
      &:hover:not(:disabled) {
        background: ${(p) => p.theme.color.dangerHover};
        border-color: ${(p) => p.theme.color.dangerHover};
      }
    `,
    text: css`
      background: transparent;
      color: ${(p) => p.theme.color.text};
      border-color: transparent;
      &:hover:not(:disabled) {
        background: ${(p) => p.theme.color.surfaceAlt};
      }
    `,
  })[v];

const StyledButton = styled.button<{
  $variant: ButtonVariant;
  $size: ButtonSize;
  $block: boolean;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${(p) => p.theme.space(2)};
  height: ${(p) => SIZES[p.$size].h}px;
  padding: 0 ${(p) => SIZES[p.$size].px}px;
  font-size: ${(p) => SIZES[p.$size].fs}px;
  font-weight: 600;
  font-family: inherit;
  line-height: 1;
  width: ${(p) => (p.$block ? '100%' : 'auto')};
  border: 1px solid transparent;
  border-radius: ${(p) => p.theme.radii.md}px;
  cursor: pointer;
  text-decoration: none;
  white-space: nowrap;
  transition: background ${(p) => p.theme.motion.fast}, border-color ${(p) => p.theme.motion.fast},
    color ${(p) => p.theme.motion.fast}, filter ${(p) => p.theme.motion.fast};
  ${(p) => variantStyles(p.$variant)}
  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.brand};
    outline-offset: 2px;
  }
`;

/** Bespoke button — variants, sizes, optional emoji icon, and link mode via `href`. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', block = false, loading = false, icon, href, children, disabled, ...rest },
  ref,
) {
  return (
    <StyledButton
      ref={ref}
      as={href ? 'a' : 'button'}
      href={href}
      $variant={variant}
      $size={size}
      $block={block}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span aria-hidden>⏳</span> : icon ? <span aria-hidden>{icon}</span> : null}
      {children}
    </StyledButton>
  );
});
