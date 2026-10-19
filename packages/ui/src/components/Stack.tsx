import React from 'react';
import clsx from 'clsx';
import styles from './Stack.module.css';

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gap between children, in 4px spacing units → `space(gap)`. */
  gap?: number;
  align?: React.CSSProperties['alignItems'];
}

export interface InlineProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gap between children, in 4px spacing units → `space(gap)`. */
  gap?: number;
  align?: React.CSSProperties['alignItems'];
  justify?: React.CSSProperties['justifyContent'];
  wrap?: boolean;
}

/**
 * The per-instance layout values. Alignment goes straight onto the element's own `style` — it is
 * an arbitrary CSS keyword, not one of a fixed set a class could name — under the caller's
 * `style`, so an explicit override still wins.
 */
function layoutStyle(
  gap: number,
  style: React.CSSProperties | undefined,
  align?: React.CSSProperties['alignItems'],
  justify?: React.CSSProperties['justifyContent'],
): React.CSSProperties {
  return {
    '--pq-gap': `${gap * 4}px`,
    ...(align === undefined ? {} : { alignItems: align }),
    ...(justify === undefined ? {} : { justifyContent: justify }),
    ...style,
  } as React.CSSProperties;
}

/** Vertical flex stack — children flow top-to-bottom with a spacing-scale gap. */
export const Stack = React.forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap = 0, align, className, style, children, ...rest },
  ref,
): React.ReactElement {
  return (
    <div
      ref={ref}
      className={clsx(styles.stack, className)}
      style={layoutStyle(gap, style, align)}
      {...rest}
    >
      {children}
    </div>
  );
});

/** Horizontal flex row — children flow left-to-right with a spacing-scale gap. */
export const Inline = React.forwardRef<HTMLDivElement, InlineProps>(function Inline(
  { gap = 0, align, justify, wrap = false, className, style, children, ...rest },
  ref,
): React.ReactElement {
  return (
    <div
      ref={ref}
      className={clsx(styles.inline, wrap && styles.wrap, className)}
      style={layoutStyle(gap, style, align, justify)}
      {...rest}
    >
      {children}
    </div>
  );
});
