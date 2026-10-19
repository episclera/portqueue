import React from 'react';
import clsx from 'clsx';
import styles from './Input.module.css';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/** Bespoke multiline input — matches Input's visual language with vertical resize. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className, ...rest },
  ref,
): React.ReactElement {
  return (
    <textarea
      ref={ref}
      className={clsx(styles.field, styles.textarea, invalid && styles.invalid, className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
