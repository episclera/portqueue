/**
 * Design tokens — the single source of truth for the PortQueue visual system, shared by the
 * dashboard and the docs site. Encodes the calm, muted palette: a dominant light grey, a
 * desaturated green primary, and low-contrast semantic colours that always pair with the one
 * near-black text colour (never white). Exposed to CSS as variables by the ThemeProvider.
 */
export const tokens = {
  color: {
    // Primary accent — desaturated green. Never used as a large background fill.
    brand: '#A9D8B8',
    brandHover: '#6FA184',
    // Optional informational tone (tooltips, neutral notices).
    accent: '#8FB8D8',

    // Dominant neutral surfaces (light grey covers most of the screen).
    bgLight: '#F2F3F1',
    surfaceLight: '#ffffff',
    bgDark: '#171A19',
    surfaceDark: '#1F2422',

    // The only text colour (near-black, cool). Opacity is applied for muted variants.
    textLight: '#1B1F1D',
    textDark: '#EDEFEC',

    // Borders, dividers, inputs, code blocks, disabled states.
    secondary: '#DDE3DE',

    // Semantic — muted, low-contrast; only used where meaning genuinely calls for it.
    danger: '#D98A8A',
    dangerHover: '#B5645F',
    warning: '#E0AE72',
    warningHover: '#C68A4E',
    info: '#8FB8D8',

    // Semantic job-status colours (single source of truth; mirrored by the CLI). Tuned to the
    // muted palette and darkened enough to stay legible as outline-tag text on light surfaces.
    status: {
      PENDING: '#8A908C',
      ACTIVE: '#5B87A8',
      COMPLETED: '#6FA184',
      FAILED: '#B5645F',
      RETRY: '#C68A4E',
      CANCELLED: '#9AA09C',
      EXPIRED: '#9AA09C',
      STALLED: '#9A7AA0',
    },
  },
  radii: { sm: 6, md: 10, lg: 16, pill: 999 },
  spacing: (n: number): number => n * 4, // 4px base scale
  shadow: {
    sm: '0 1px 2px rgba(27,31,29,0.05), 0 1px 3px rgba(27,31,29,0.08)',
    md: '0 4px 12px rgba(27,31,29,0.07), 0 2px 6px rgba(27,31,29,0.05)',
    lg: '0 12px 32px rgba(27,31,29,0.10), 0 6px 16px rgba(27,31,29,0.07)',
  },
  /**
   * Stacking order for floating layers, all of which render into a body portal. Page chrome
   * sits low; dialogs sit above it; the transient layers a dialog can itself contain
   * (popovers, menus, selects) sit above dialogs; tooltips are last so they are never covered.
   */
  zIndex: {
    header: 100,
    drawer: 200,
    modal: 1000,
    popover: 1100,
    dropdown: 1200,
    select: 1300,
    toast: 1400,
    tooltip: 1500,
  },
  breakpoints: { xs: 480, sm: 640, md: 768, lg: 1024, xl: 1280 },
  motion: {
    fast: '120ms cubic-bezier(0.4, 0, 0.2, 1)',
    base: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '320ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
} as const;

export type StatusColorKey = keyof typeof tokens.color.status;
