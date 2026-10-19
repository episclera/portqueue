import React from 'react';
import clsx from 'clsx';
import styles from './Tag.module.css';

export type TagVariant = 'soft' | 'outline' | 'solid';
export type TagTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic tone resolved from the palette. Ignored when `color` is set. */
  tone?: TagTone;
  /** Explicit CSS colour override; prefer `tone` so tags stay on-palette. */
  color?: string;
  variant?: TagVariant;
  /** Fully rounded pill shape. */
  pill?: boolean;
}

/** Compact label chip. `tone` picks a palette colour; `variant` controls soft/outline/solid. */
export function Tag({
  tone = 'neutral',
  color,
  variant = 'soft',
  pill = false,
  className,
  style,
  children,
  ...rest
}: TagProps): React.ReactElement {
  return (
    <span
      className={clsx(
        styles.root,
        tone !== 'neutral' && styles[tone],
        styles[variant],
        pill && styles.pill,
        className,
      )}
      style={
        color === undefined ? style : ({ '--pq-tag-color': color, ...style } as React.CSSProperties)
      }
      {...rest}
    >
      {children}
    </span>
  );
}
