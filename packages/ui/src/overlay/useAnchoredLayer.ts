/**
 * Positions a portalled layer against its trigger using viewport (`position: fixed`)
 * coordinates: the layer lives in `document.body`, so it must be measured against the
 * trigger's client rect rather than laid out next to it. Flips above the trigger when there
 * isn't room below, clamps to the viewport on both axes, and re-measures on scroll/resize.
 */
import React from 'react';

/** Which edge of the trigger the layer is aligned to horizontally. */
export type LayerAlign = 'start' | 'end' | 'stretch';

export type LayerPlacement = 'bottom' | 'top';

export interface LayerPosition {
  top: number;
  left: number;
  /** Set only for `stretch` alignment, where the layer matches the trigger width. */
  width: number | null;
  /** Room left between the layer and the viewport edge on the chosen side. */
  maxHeight: number;
  placement: LayerPlacement;
}

export interface UseAnchoredLayerOptions {
  open: boolean;
  align?: LayerAlign;
  /** Gap between trigger and layer, in px. */
  gap?: number;
  /** Width assumed before the layer has been measured. */
  minWidth?: number;
}

export interface UseAnchoredLayerResult<T extends HTMLElement, L extends HTMLElement> {
  triggerRef: React.RefObject<T>;
  layerRef: React.RefObject<L>;
  /** `null` until measured; render the layer only once it is set. */
  position: LayerPosition | null;
}

/** Keep-out margin from the viewport edges. */
const EDGE = 8;
/** Never squash a flipped layer below this, even in a very short viewport. */
const MIN_HEIGHT = 120;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

function measure(
  trigger: DOMRect,
  layer: { width: number; height: number },
  align: LayerAlign,
  gap: number,
): LayerPosition {
  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;

  const roomBelow = viewportHeight - trigger.bottom - gap - EDGE;
  const roomAbove = trigger.top - gap - EDGE;
  // Prefer below; only flip when the layer genuinely doesn't fit and above is roomier.
  const placement: LayerPlacement =
    layer.height <= roomBelow || roomBelow >= roomAbove ? 'bottom' : 'top';

  const maxHeight = Math.max(MIN_HEIGHT, placement === 'bottom' ? roomBelow : roomAbove);
  const width = align === 'stretch' ? trigger.width : layer.width;

  const rawLeft = align === 'end' ? trigger.right - width : trigger.left;
  const left = clamp(rawLeft, EDGE, viewportWidth - width - EDGE);

  const height = Math.min(layer.height, maxHeight);
  const top =
    placement === 'bottom'
      ? clamp(trigger.bottom + gap, EDGE, viewportHeight - EDGE)
      : Math.max(EDGE, trigger.top - gap - height);

  return { top, left, width: align === 'stretch' ? trigger.width : null, maxHeight, placement };
}

const same = (a: LayerPosition, b: LayerPosition): boolean =>
  Math.abs(a.top - b.top) <= 1 &&
  Math.abs(a.left - b.left) <= 1 &&
  Math.abs((a.width ?? 0) - (b.width ?? 0)) <= 1 &&
  Math.abs(a.maxHeight - b.maxHeight) <= 1 &&
  a.placement === b.placement;

export function useAnchoredLayer<T extends HTMLElement, L extends HTMLElement>({
  open,
  align = 'start',
  gap = 6,
  minWidth = 0,
}: UseAnchoredLayerOptions): UseAnchoredLayerResult<T, L> {
  const triggerRef = React.useRef<T>(null);
  const layerRef = React.useRef<L>(null);
  const [position, setPosition] = React.useState<LayerPosition | null>(null);

  const place = React.useCallback((): void => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const node = layerRef.current;
    // Before the first paint the layer doesn't exist yet — assume its declared minimum.
    const layer = node
      ? { width: node.offsetWidth, height: node.scrollHeight }
      : { width: Math.max(minWidth, trigger.width), height: 0 };
    const next = measure(trigger, layer, align, gap);
    setPosition((prev) => (prev && same(prev, next) ? prev : next));
  }, [align, gap, minWidth]);

  React.useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
  }, [open, place]);

  // Second pass: the layer is mounted now, so re-place against its real size. `same()` keeps
  // the previous object when nothing moved, which stops this from looping.
  React.useLayoutEffect(() => {
    if (!open || !position) return;
    place();
  }, [open, position, place]);

  React.useEffect(() => {
    if (!open) return;
    const onViewportChange = (): void => place();
    window.addEventListener('resize', onViewportChange);
    // Capture phase so scrolling any ancestor container moves the layer too.
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, place]);

  return { triggerRef, layerRef, position };
}
