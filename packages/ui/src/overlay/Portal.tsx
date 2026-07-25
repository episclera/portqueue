/**
 * The single escape hatch every floating layer uses. Rendering into `document.body` keeps
 * overlays out of the trigger's stacking/clipping context, so an ancestor with
 * `overflow: hidden` (a Card, a scrolling table) or its own `z-index` can never clip or
 * under-stack a menu, popover, tooltip or dialog.
 */
import React from 'react';
import { createPortal } from 'react-dom';

export interface PortalProps {
  children: React.ReactNode;
  /** Host node for the layer. Defaults to `document.body`. */
  container?: Element | null;
}

export const Portal = ({ children, container }: PortalProps): React.ReactElement | null => {
  // Server render (Docusaurus prerender) has no DOM — layers only exist after interaction.
  if (typeof document === 'undefined') return null;
  return createPortal(children, container ?? document.body);
};
