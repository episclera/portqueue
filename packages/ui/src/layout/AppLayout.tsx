import React from 'react';
import clsx from 'clsx';
import styles from './AppLayout.module.css';

/** Full-height application shell — sets the page background, base text colour and font. */
export const AppShell = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function AppShell({ className, ...rest }, ref): React.ReactElement {
    return <div ref={ref} className={clsx(styles.appShell, className)} {...rest} />;
  },
);

export interface HeaderProps extends React.HTMLAttributes<HTMLElement> {
  /** Content pinned to the left (e.g. logo / brand). */
  left?: React.ReactNode;
  /** Content pinned to the right (e.g. actions, theme toggle). */
  right?: React.ReactNode;
  /** Central content — flexes to fill (e.g. nav, search). */
  children?: React.ReactNode;
}

/** Sticky, opaque top bar with left / center / right slots. Shared by dashboard + docs. */
export const Header = React.forwardRef<HTMLElement, HeaderProps>(function Header(
  { left, right, children, className, ...rest },
  ref,
): React.ReactElement {
  return (
    <header ref={ref} className={clsx(styles.header, className)} {...rest}>
      {left != null ? <div className={styles.headerSlot}>{left}</div> : null}
      <div className={styles.headerCenter}>{children}</div>
      {right != null ? <div className={styles.headerSlot}>{right}</div> : null}
    </header>
  );
});

/** Content column — spans the full available width with responsive padding. */
export const Content = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  function Content({ className, ...rest }, ref): React.ReactElement {
    return <main ref={ref} className={clsx(styles.content, className)} {...rest} />;
  },
);

/** Muted, centered footer with a top border. */
export const Footer = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  function Footer({ className, ...rest }, ref): React.ReactElement {
    return <footer ref={ref} className={clsx(styles.footer, className)} {...rest} />;
  },
);

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned actions (buttons, links). */
  extra?: React.ReactNode;
}

/** Page subheader band — title, one-line description, and right-aligned actions. */
export const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(function PageHeader(
  { title, subtitle, extra, className, ...rest },
  ref,
): React.ReactElement {
  return (
    <div ref={ref} className={clsx(styles.pageHeader, className)} {...rest}>
      <div className={styles.pageHeaderText}>
        <h1 className={styles.pageTitle}>{title}</h1>
        {subtitle != null ? <p className={styles.pageSubtitle}>{subtitle}</p> : null}
      </div>
      {extra != null ? <div className={styles.pageHeaderExtra}>{extra}</div> : null}
    </div>
  );
});
