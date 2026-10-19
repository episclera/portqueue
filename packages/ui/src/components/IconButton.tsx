import React from 'react';
import clsx from 'clsx';
import { Button, type ButtonProps } from './Button';
import styles from './IconButton.module.css';

/**
 * Square, label-less button for an icon — same sizes and variants as `Button`, so the label
 * lives in `aria-label` (and usually a Tooltip) instead of beside the glyph.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, ButtonProps>(function IconButton(
  { className, ...rest },
  ref,
) {
  // An unset size keeps the narrowest square, as it always has (the button itself defaults to md).
  const width = rest.size === 'lg' ? styles.lg : rest.size === 'md' ? styles.md : styles.sm;
  return <Button ref={ref} className={clsx(styles.iconButton, width, className)} {...rest} />;
});
