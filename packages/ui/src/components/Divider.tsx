import React from 'react';
import clsx from 'clsx';
import styles from './Divider.module.css';

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  vertical?: boolean;
  /** Optional centered label — only shown on horizontal dividers. */
  label?: React.ReactNode;
}

/** Bespoke divider — a horizontal rule (optionally with a centered label) or a vertical rule. */
export const Divider = React.forwardRef<HTMLDivElement, DividerProps>(function Divider(
  { vertical = false, label, className, ...rest },
  ref,
): React.ReactElement {
  if (vertical) {
    return (
      <div
        ref={ref}
        className={clsx(styles.vRule, className)}
        role="separator"
        aria-orientation="vertical"
        {...rest}
      />
    );
  }
  return (
    <div
      ref={ref}
      className={clsx(styles.hRule, label != null ? styles.labelled : styles.plain, className)}
      role="separator"
      {...rest}
    >
      {label != null ? <span>{label}</span> : null}
    </div>
  );
});
