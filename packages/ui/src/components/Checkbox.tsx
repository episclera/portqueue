import React from 'react';
import clsx from 'clsx';
import styles from './Checkbox.module.css';

/** Themed checkbox — used by Table's selection column and any filter/option list. */
export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Checkbox({ className, ...rest }, ref) {
  return <input ref={ref} type="checkbox" className={clsx(styles.checkbox, className)} {...rest} />;
});
