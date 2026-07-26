import React from 'react';
import styled, { css } from 'styled-components';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  inputSize?: InputSize;
}

/** Height / horizontal-padding / font-size per size — shared with InputNumber. */
export const INPUT_SIZES: Record<InputSize, { h: number; px: number; fs: number }> = {
  sm: { h: 30, px: 10, fs: 13 },
  md: { h: 38, px: 12, fs: 14 },
  lg: { h: 46, px: 14, fs: 16 },
};

export const fieldBaseStyles = css<{ $invalid: boolean }>`
  width: 100%;
  box-sizing: border-box;
  color: ${(p) => p.theme.color.text};
  background: ${(p) => p.theme.color.surface};
  border: 1px solid ${(p) => (p.$invalid ? p.theme.color.danger : p.theme.color.border)};
  border-radius: ${(p) => p.theme.radii.md}px;
  font-family: inherit;
  transition:
    border-color ${(p) => p.theme.motion.fast},
    box-shadow ${(p) => p.theme.motion.fast};

  &::placeholder {
    color: ${(p) => p.theme.color.textFaint};
  }

  &:hover:not(:disabled):not(:focus) {
    border-color: ${(p) => (p.$invalid ? p.theme.color.danger : p.theme.color.borderStrong)};
  }

  &:focus {
    outline: none;
    border-color: ${(p) => (p.$invalid ? p.theme.color.danger : p.theme.color.brand)};
    box-shadow: 0 0 0 3px ${(p) => (p.$invalid ? p.theme.color.danger : p.theme.color.brand)}33;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const StyledInput = styled.input<{ $invalid: boolean; $size: InputSize }>`
  ${fieldBaseStyles}
  height: ${(p) => INPUT_SIZES[p.$size].h}px;
  padding: 0 ${(p) => INPUT_SIZES[p.$size].px}px;
  font-size: ${(p) => INPUT_SIZES[p.$size].fs}px;
`;

/** Bespoke text input — themed border, brand focus ring, invalid + size variants. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, inputSize = 'md', ...rest },
  ref,
): React.ReactElement {
  return (
    <StyledInput
      ref={ref}
      $invalid={invalid}
      $size={inputSize}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
