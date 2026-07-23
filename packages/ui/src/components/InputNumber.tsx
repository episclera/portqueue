import React from 'react';
import styled from 'styled-components';
import { fieldBaseStyles, INPUT_SIZES, type InputSize } from './Input';

export interface InputNumberProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  inputSize?: InputSize;
}

const StyledInput = styled.input<{ $invalid: boolean; $size: InputSize }>`
  ${fieldBaseStyles}
  height: ${(p) => INPUT_SIZES[p.$size].h}px;
  padding: 0 ${(p) => INPUT_SIZES[p.$size].px}px;
  font-size: ${(p) => INPUT_SIZES[p.$size].fs}px;
`;

/** Numeric input — parses to `number | null` (empty string → null) on change. */
export function InputNumber({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  disabled = false,
  invalid = false,
  inputSize = 'md',
}: InputNumberProps): React.ReactElement {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value;
    if (raw === '') {
      onChange?.(null);
      return;
    }
    const parsed = Number(raw);
    onChange?.(Number.isNaN(parsed) ? null : parsed);
  };

  return (
    <StyledInput
      type="number"
      value={value ?? ''}
      onChange={handleChange}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      disabled={disabled}
      $invalid={invalid}
      $size={inputSize}
      aria-invalid={invalid || undefined}
    />
  );
}
