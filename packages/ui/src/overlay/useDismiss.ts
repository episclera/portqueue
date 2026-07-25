/**
 * Outside-click + Escape dismissal for a portalled layer. Once the layer lives in
 * `document.body` it is no longer a DOM descendant of its trigger, so "did the click land
 * inside?" has to consider both nodes — otherwise the pointer-down that selects a menu item
 * would close the layer and the click would never reach the item.
 */
import React from 'react';

export interface UseDismissOptions {
  open: boolean;
  onDismiss: () => void;
  /** Nodes considered "inside": normally the trigger and the layer. */
  refs: Array<React.RefObject<HTMLElement | null>>;
}

export function useDismiss({ open, onDismiss, refs }: UseDismissOptions): void {
  const latest = React.useRef({ onDismiss, refs });
  latest.current = { onDismiss, refs };

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      const inside = latest.current.refs.some((ref) => ref.current?.contains(target));
      if (!inside) latest.current.onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') latest.current.onDismiss();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
}
