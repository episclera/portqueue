import React from 'react';
import clsx from 'clsx';
import styles from './Card.module.css';

export interface CardHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Trailing content (actions, badges). */
  extra?: React.ReactNode;
  /** Leading icon. */
  icon?: React.ReactNode;
  className?: string;
}

/** Header band for a Card: title + optional subtitle, leading icon, and trailing extra. */
export function CardHeader({
  title,
  subtitle,
  extra,
  icon,
  className,
}: CardHeaderProps): React.ReactElement {
  return (
    <header className={clsx(styles.header, className)}>
      {icon ? (
        <span aria-hidden style={{ fontSize: 20 }}>
          {icon}
        </span>
      ) : null}
      <div className={styles.headerTitles}>
        <h3 className={styles.headerTitle}>{title}</h3>
        {subtitle ? <p className={styles.headerSubtitle}>{subtitle}</p> : null}
      </div>
      {extra ? <div className={styles.headerExtra}>{extra}</div> : null}
    </header>
  );
}

export interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** Convenience header; omit and compose `CardHeader`/`CardBody` for full control. */
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  extra?: React.ReactNode;
  icon?: React.ReactNode;
  interactive?: boolean;
  /** Pad the body. Default true when using `title`; set false for flush content (tables). */
  bodyPadding?: boolean;
}

/** Surface container. With `title` it renders a header + padded body; otherwise a plain padded surface. */
export const Card = React.forwardRef<HTMLElement, CardProps>(function Card(
  {
    title,
    subtitle,
    extra,
    icon,
    interactive = false,
    bodyPadding = true,
    className,
    children,
    ...rest
  },
  ref,
): React.ReactElement {
  if (title !== undefined || subtitle !== undefined || extra !== undefined) {
    return (
      <section
        ref={ref}
        className={clsx(styles.card, interactive && styles.interactive, className)}
        {...rest}
      >
        <CardHeader title={title} subtitle={subtitle} extra={extra} icon={icon} />
        <div className={clsx(bodyPadding && styles.padded)}>{children}</div>
      </section>
    );
  }
  return (
    <section
      ref={ref}
      className={clsx(
        styles.card,
        bodyPadding && styles.padded,
        interactive && styles.interactive,
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
});

/** Body region for a manually-composed Card. */
export function CardBody({
  padding = true,
  className,
  children,
}: {
  padding?: boolean;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return <div className={clsx(padding && styles.padded, className)}>{children}</div>;
}

/** A lighter inset surface for grouping content inside a page or card. */
export const Panel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Panel({ className, ...rest }, ref) {
    return <div ref={ref} className={clsx(styles.panel, className)} {...rest} />;
  },
);
