import React from 'react';
import clsx from 'clsx';
import styles from './Input.module.css';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  inputSize?: InputSize;
}

/** Bespoke text input — themed border, brand focus ring, invalid + size variants. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, inputSize = 'md', className, ...rest },
  ref,
): React.ReactElement {
  return (
    <input
      ref={ref}
      className={clsx(styles.field, styles[inputSize], invalid && styles.invalid, className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
