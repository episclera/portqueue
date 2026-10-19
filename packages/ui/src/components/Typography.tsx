import React from 'react';
import clsx from 'clsx';
import styles from './Typography.module.css';

type TitleLevel = 1 | 2 | 3 | 4 | 5;

export type TextTone = 'default' | 'muted' | 'faint' | 'brand' | 'danger' | 'success';

/** The elements a `Title` may render as — headings, plus inline/block wrappers for a heading-styled label. */
type TitleElement = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'span' | 'div';

/**
 * Heading. `level` maps to size/weight; `as` picks the element (an `h2` by default), so a
 * heading-styled label can sit inside a row without becoming a document heading.
 */
export const Title = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { level?: TitleLevel; as?: TitleElement }
>(function Title({ level = 2, as: Element = 'h2', className, ...rest }, ref): React.ReactElement {
  return (
    <Element
      ref={ref}
      className={clsx(styles.title, styles[`level${level}`], className)}
      {...rest}
    />
  );
});

/** Inline text with a tone and optional strong/small styling. */
export const Text = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { tone?: TextTone; strong?: boolean; small?: boolean }
>(function Text(
  { tone = 'default', strong = false, small = false, className, ...rest },
  ref,
): React.ReactElement {
  return (
    <span
      ref={ref}
      className={clsx(
        styles.text,
        styles[tone],
        strong && styles.strong,
        small && styles.small,
        className,
      )}
      {...rest}
    />
  );
});

/** Block paragraph with comfortable measure and muted tone by default. */
export const Paragraph = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { tone?: TextTone }
>(function Paragraph({ tone = 'muted', className, ...rest }, ref): React.ReactElement {
  return <p ref={ref} className={clsx(styles.paragraph, styles[tone], className)} {...rest} />;
});

/** Inline monospace code token. */
export const Code = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(function Code(
  { className, ...rest },
  ref,
): React.ReactElement {
  return <code ref={ref} className={clsx(styles.code, className)} {...rest} />;
});

/** Undecorated monospace text — ids, keys, patterns. */
export const Mono = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  function Mono({ className, ...rest }, ref): React.ReactElement {
    return <span ref={ref} className={clsx(styles.mono, className)} {...rest} />;
  },
);
