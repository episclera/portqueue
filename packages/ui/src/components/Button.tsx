import React from 'react';
import clsx from 'clsx';
import { LoadingIcon } from '../icons';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger' | 'text';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    Pick<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  /** Leading content — an icon element from `@portqueue/ui`'s icon set. */
  icon?: React.ReactNode;
}

/** Bespoke button — variants, sizes, optional leading icon, and link mode via `href`. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    block = false,
    loading = false,
    icon,
    href,
    children,
    disabled,
    className,
    ...rest
  },
  ref,
) {
  const classes = clsx(
    styles.button,
    styles[variant],
    styles[size],
    block && styles.block,
    className,
  );
  const content = (
    <>
      {loading ? (
        // `spin` is the icon set's own animation, so a busy button needs no keyframes here.
        <LoadingIcon spin aria-hidden />
      ) : icon ? (
        <span aria-hidden>{icon}</span>
      ) : null}
      {children}
    </>
  );
  // Link mode (`href`) renders an anchor with the same classes and props.
  return React.createElement(
    href ? 'a' : 'button',
    {
      ref,
      href,
      className: classes,
      disabled: disabled ?? loading,
      'aria-busy': loading || undefined,
      ...rest,
    },
    content,
  );
});
