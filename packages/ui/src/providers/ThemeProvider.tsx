import React from 'react';
import { ThemeProvider as StyledThemeProvider, createGlobalStyle } from 'styled-components';
import { darkTheme, lightTheme } from '../theme/theme';

export interface ThemeProviderProps {
  mode?: 'light' | 'dark';
  /** When true, applies base page styles (background, text colour, font) to the body. */
  applyGlobalStyles?: boolean;
  children: React.ReactNode;
}

/**
 * Base global styles. Kept intentionally light — box-sizing, sensible body defaults, and
 * reduced-motion — so the library composes cleanly inside host apps (dashboard SPA, and
 * the Docusaurus docs site, which owns its own body styles).
 */
export const GlobalStyle = createGlobalStyle`
  :root {
    --bg: ${(p) => p.theme.color.bg};
    --surface: ${(p) => p.theme.color.surface};
    --primary: ${(p) => p.theme.color.brand};
    --primary-dark: ${(p) => p.theme.color.brandHover};
    --link: ${(p) => p.theme.color.link};
    --secondary: ${(p) => p.theme.color.border};
    --text: ${(p) => p.theme.color.text};
    --text-muted: ${(p) => p.theme.color.textMuted};
    --danger: ${(p) => p.theme.color.danger};
    --danger-dark: ${(p) => p.theme.color.dangerHover};
    --warning: ${(p) => p.theme.color.warning};
    --warning-dark: ${(p) => p.theme.color.warningHover};
    --info: ${(p) => p.theme.color.info};
  }
  *, *::before, *::after { box-sizing: border-box; }
  a {
    color: ${(p) => p.theme.color.link};
    text-decoration: none;
  }
  a:hover { text-decoration: underline; }
  body {
    margin: 0;
    background: ${(p) => p.theme.color.bg};
    color: ${(p) => p.theme.color.text};
    font-family: ${(p) => p.theme.font.family};
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

/**
 * Wraps children in the styled-components theme (light/dark). Every `@portqueue/ui`
 * component requires this ancestor. `applyGlobalStyles` is opt-in so hosts that manage
 * their own body (e.g. Docusaurus) can skip it.
 */
export function ThemeProvider({
  mode = 'light',
  applyGlobalStyles = false,
  children,
}: ThemeProviderProps): React.ReactElement {
  return (
    <StyledThemeProvider theme={mode === 'dark' ? darkTheme : lightTheme}>
      {applyGlobalStyles ? <GlobalStyle /> : null}
      {children}
    </StyledThemeProvider>
  );
}
