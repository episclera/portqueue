import React from 'react';
import clsx from 'clsx';
import styles from './ScrollShadow.module.css';

export interface ScrollShadowProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/** How many pixels of remaining scroll still count as "at the end" — absorbs sub-pixel widths. */
const EPSILON = 1;

/**
 * Horizontal scroller that fades its clipped edges, so a table wider than its card reads as
 * scrollable instead of merely cut off. The left fade appears once scrolled away from the start
 * and the right one whenever content remains; a table that fits shows neither.
 *
 * The overflow state is measured rather than assumed: it is recomputed on scroll, on viewport
 * resize, and on content resize (rows arriving, a column widening), because none of those fire
 * a scroll event on their own.
 */
export function ScrollShadow({
  children,
  className,
  ...rest
}: ScrollShadowProps): React.ReactElement {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ start: false, end: false });

  const measure = React.useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const next = {
      start: el.scrollLeft > EPSILON,
      end: maxScroll > EPSILON && el.scrollLeft < maxScroll - EPSILON,
    };
    // Only re-render on a real transition; a scroll event fires on every frame of a drag.
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);

  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    measure();

    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);

    // Rows arriving or a column widening changes scrollWidth without any scroll or resize event.
    // Guarded because jsdom (and older browsers) have no ResizeObserver.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    if (observer) {
      observer.observe(el);
      // The table, not just the viewport: its width is what overflows.
      if (el.firstElementChild) observer.observe(el.firstElementChild);
    }

    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [measure, children]);

  return (
    <div className={clsx(styles.root, className)} {...rest}>
      <div className={clsx(styles.fade, styles.left, edges.start && styles.visible)} aria-hidden />
      <div ref={viewportRef} className={styles.viewport}>
        {children}
      </div>
      <div className={clsx(styles.fade, styles.right, edges.end && styles.visible)} aria-hidden />
    </div>
  );
}
