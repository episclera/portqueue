import React from 'react';
import clsx from 'clsx';
import type { InputSize } from './Input';
import styles from './Input.module.css';

/**
 * Extends the native input props so a caller can pass `id`, `name` and any `aria-*`. A
 * `<Field htmlFor>` label needs the `id` to reach the element it names; without one the label is
 * orphaned — clicking it focuses nothing and a screen reader announces an unlabelled spinbutton.
 */
export interface InputNumberProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'size'
> {
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
  className,
  ...rest
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
    <input
      {...rest}
      className={clsx(styles.field, styles[inputSize], invalid && styles.invalid, className)}
      type="number"
      value={value ?? ''}
      onChange={handleChange}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={invalid || undefined}
    />
  );
}
