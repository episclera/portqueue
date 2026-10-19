import React from 'react';
import clsx from 'clsx';
import styles from './Spinner.module.css';

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Outer diameter in px. Defaults to 20. */
  size?: number;
}

/** CSS spinner ring — brand-coloured top segment rotating over a muted border. */
export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { size = 20, className, style, ...rest },
  ref,
): React.ReactElement {
  return (
    <span
      ref={ref}
      className={clsx(styles.ring, className)}
      style={
        {
          '--pq-spinner-size': `${size}px`,
          '--pq-spinner-ring': `${Math.max(2, Math.round(size / 10))}px`,
          ...style,
        } as React.CSSProperties
      }
      role="status"
      aria-label="Loading"
      {...rest}
    />
  );
});
