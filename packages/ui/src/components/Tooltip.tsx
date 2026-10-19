import React from 'react';
import clsx from 'clsx';
import { Portal } from '../overlay/Portal';
import styles from './Tooltip.module.css';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  title: React.ReactNode;
  placement?: TooltipPlacement;
  /**
   * Fill the width of the parent instead of hugging the child. For a block-level trigger — a card
   * body, a whole row — where an inline wrapper would shrink the content it wraps.
   */
  block?: boolean;
  children: React.ReactElement;
  className?: string;
  style?: React.CSSProperties;
}

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
  block = false,
  children,
  className,
  style,
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
      <span
        ref={triggerRef}
        className={clsx(styles.wrapper, block && styles.block, className)}
        style={style}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {coords ? (
        <Portal>
          <span
            ref={bubbleRef}
            className={styles.bubble}
            style={{ top: coords.top, left: coords.left }}
            role="tooltip"
          >
            {title}
          </span>
        </Portal>
      ) : null}
    </>
  );
};
