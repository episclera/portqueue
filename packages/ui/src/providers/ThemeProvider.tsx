import React, { createContext, useContext, useLayoutEffect } from 'react';
import '../theme/theme.css';
import '../styles/global.css';

export interface ThemeProviderProps {
  mode?: 'light' | 'dark';
  /** When true, applies base page styles (background, text colour, font) to the body. */
  applyGlobalStyles?: boolean;
  children: React.ReactNode;
}

const ThemeModeContext = createContext<'light' | 'dark'>('light');

/** The theme in effect under the nearest `ThemeProvider` — `'light'` when there is none. */
export function useTheme(): { mode: 'light' | 'dark' } {
  return { mode: useContext(ThemeModeContext) };
}

/**
 * Applies the light/dark theme. The theme itself is CSS custom properties (`theme/theme.css`), so
 * this sets `data-pq-theme` on `<html>` rather than wrapping children in an element: the layers
 * that render into a body portal (modals, menus, tooltips, toasts) must see the same variables.
 * `applyGlobalStyles` is opt-in — it sets `data-pq-global`, which `styles/global.css` is gated on —
 * so a host that manages its own body (e.g. Docusaurus) can skip it.
 *
 * A layout effect, so the attribute is in place before the first paint and a dark-mode visitor
 * never sees a light frame.
 */
export function ThemeProvider({
  mode = 'light',
  applyGlobalStyles = false,
  children,
}: ThemeProviderProps): React.ReactElement {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.pqTheme = mode;
    return () => {
      delete root.dataset.pqTheme;
    };
  }, [mode]);

  useLayoutEffect(() => {
    if (!applyGlobalStyles) return;
    const root = document.documentElement;
    root.dataset.pqGlobal = '';
    return () => {
      delete root.dataset.pqGlobal;
    };
  }, [applyGlobalStyles]);

  return <ThemeModeContext.Provider value={mode}>{children}</ThemeModeContext.Provider>;
}
