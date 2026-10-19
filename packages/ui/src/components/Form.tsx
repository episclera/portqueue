import React from 'react';
import clsx from 'clsx';
import styles from './Form.module.css';

export const Form = React.forwardRef<HTMLFormElement, React.FormHTMLAttributes<HTMLFormElement>>(
  function Form({ className, ...rest }, ref) {
    return <form ref={ref} className={clsx(styles.form, className)} {...rest} />;
  },
);

export interface FieldProps {
  label?: React.ReactNode;
  required?: boolean;
  error?: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/** Presentational field wrapper — label, control, then an error or hint below. */
export function Field({
  label,
  required = false,
  error,
  hint,
  htmlFor,
  className,
  style,
  children,
}: FieldProps): React.ReactElement {
  return (
    <div className={clsx(styles.field, className)} style={style}>
      {label !== undefined && (
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
          {required ? (
            <span className={styles.required} aria-hidden>
              *
            </span>
          ) : null}
        </label>
      )}
      {children}
      {error !== undefined && error !== null && error !== false ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : hint !== undefined && hint !== null && hint !== false ? (
        <p className={styles.hint}>{hint}</p>
      ) : null}
    </div>
  );
}
