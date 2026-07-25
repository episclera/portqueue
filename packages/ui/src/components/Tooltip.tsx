import React from 'react';
import styled from 'styled-components';
import { Portal } from '../overlay/Portal';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  title: React.ReactNode;
  placement?: TooltipPlacement;
  children: React.ReactElement;
}

const Wrapper = styled.span`
  position: relative;
  display: inline-flex;
`;

/**
 * Rendered in a body portal with fixed coordinates, so an ancestor with `overflow: hidden`
 * (a Card, a horizontally scrolling table) can never clip it. Sits at the top of the stack —
 * a tooltip can be triggered from inside a dialog, a menu or a popover.
 */
const Bubble = styled.span<{ $top: number; $left: number }>`
  position: fixed;
  top: ${(p) => p.$top}px;
  left: ${(p) => p.$left}px;
  z-index: ${(p) => p.theme.zIndex.tooltip};
  max-width: 240px;
  padding: 5px 9px;
  font-family: ${(p) => p.theme.font.family};
  font-size: 12.5px;
  line-height: 1.4;
  font-weight: 500;
  white-space: normal;
  color: #ffffff;
  background: #1f2530;
  border-radius: ${(p) => p.theme.radii.sm}px;
  box-shadow: ${(p) => p.theme.shadow.md};
  pointer-events: none;
`;

const OFFSET = 6;
const ESTIMATED = { width: 180, height: 30 };

/** Place the bubble against the trigger rect, flipping when it would leave the viewport. */
function position(
  rect: DOMRect,
  placement: TooltipPlacement,
  bubble: { width: number; height: number },
): { top: number; left: number } {
  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;

  let effective = placement;
  if (placement === 'top' && rect.top < bubble.height + OFFSET) effective = 'bottom';
  if (placement === 'bottom' && rect.bottom + bubble.height + OFFSET > viewportHeight)
    effective = 'top';
  if (placement === 'left' && rect.left < bubble.width + OFFSET) effective = 'right';
  if (placement === 'right' && rect.right + bubble.width + OFFSET > viewportWidth)
    effective = 'left';

  const centerX = rect.left + rect.width / 2 - bubble.width / 2;
  const centerY = rect.top + rect.height / 2 - bubble.height / 2;

  const raw = {
    top: { top: rect.top - bubble.height - OFFSET, left: centerX },
    bottom: { top: rect.bottom + OFFSET, left: centerX },
    left: { top: centerY, left: rect.left - bubble.width - OFFSET },
    right: { top: centerY, left: rect.right + OFFSET },
  }[effective];

  // Keep the bubble inside the viewport on both axes.
  return {
    top: Math.max(4, Math.min(raw.top, viewportHeight - bubble.height - 4)),
    left: Math.max(4, Math.min(raw.left, viewportWidth - bubble.width - 4)),
  };
}

/** Bespoke tooltip — shows a dark bubble on hover/focus of its single child. */
export const Tooltip = ({
  title,
  placement = 'top',
  children,
}: TooltipProps): React.ReactElement => {
  const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null);
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const bubbleRef = React.useRef<HTMLSpanElement>(null);

  const place = React.useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords(position(rect, placement, ESTIMATED));
  }, [placement]);

  // Re-place once the bubble is measurable, so the first paint isn't off by its real size.
  React.useLayoutEffect(() => {
    if (!coords) return;
    const node = bubbleRef.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    if (!width || !height) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = position(rect, placement, { width, height });
    if (Math.abs(next.top - coords.top) > 1 || Math.abs(next.left - coords.left) > 1) {
      setCoords(next);
    }
  }, [coords, placement]);

  const show = (): void => place();
  const hide = (): void => setCoords(null);

  return (
    <>
      <Wrapper
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </Wrapper>
      {coords ? (
        <Portal>
          <Bubble ref={bubbleRef} $top={coords.top} $left={coords.left} role="tooltip">
            {title}
          </Bubble>
        </Portal>
      ) : null}
    </>
  );
};
