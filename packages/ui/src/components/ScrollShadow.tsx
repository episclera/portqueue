import React from 'react';
import styled from 'styled-components';

export interface ScrollShadowProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * The scroller itself. `overscroll-behavior-x: contain` keeps a trackpad swipe that reaches the
 * end of the table from turning into a browser back-navigation.
 */
const Viewport = styled.div`
  width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
`;

const Root = styled.div`
  position: relative;
  /* The fades are painted over the scroller, so it defines their containing block. */
  isolation: isolate;
`;

/**
 * A fade over the clipped edge, hinting at the columns past it. Pointer-events are off so it
 * never eats a click on the row beneath, and it is hidden from assistive tech — a screen-reader
 * user is not scrolling pixels. `sticky`-free by design: an absolutely positioned overlay on the
 * *wrapper* stays put while the content under it moves.
 */
const Fade = styled.div<{ $side: 'left' | 'right'; $visible: boolean }>`
  position: absolute;
  top: 0;
  bottom: 0;
  ${(p) => p.$side}: 0;
  width: 40px;
  pointer-events: none;
  z-index: 1;
  opacity: ${(p) => (p.$visible ? 1 : 0)};
  transition: opacity ${(p) => p.theme.motion.fast};
  background: linear-gradient(
    to ${(p) => (p.$side === 'left' ? 'right' : 'left')},
    ${(p) => p.theme.color.surface},
    transparent
  );

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

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
export function ScrollShadow({ children, ...rest }: ScrollShadowProps): React.ReactElement {
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
    <Root {...rest}>
      <Fade $side="left" $visible={edges.start} aria-hidden />
      <Viewport ref={viewportRef}>{children}</Viewport>
      <Fade $side="right" $visible={edges.end} aria-hidden />
    </Root>
  );
}
