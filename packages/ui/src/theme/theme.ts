/**
 * The styled-components theme, derived from the shared design tokens. This is the single
 * source of truth for colours, spacing, radii, shadows and motion used by every
 * `@portqueue/ui` component — and, through them, by the dashboard and the docs site.
 *
 * Access it inside styled templates via `props.theme` (typed through the `DefaultTheme`
 * augmentation in `src/theme/styled-augmentation.ts`).
 */
import { tokens } from './tokens';
import { typography } from './typography';

export interface ThemeColor {
  brand: string;
  brandHover: string;
  /**
   * Primary-button fill + its hover. Light mode fills with the lighter green and darkens on
   * hover; dark mode fills with the darker green (so the button reads as a solid accent on the
   * dark surface) and lightens on hover. Text on both stays the near-black `onBrand` (WCAG AA).
   */
  brandSolid: string;
  brandSolidHover: string;
  /**
   * Interactive text (links, active tabs, default-button hover). The darker green in light
   * mode for AA contrast on light surfaces; the lighter green in dark mode so it stays legible
   * on dark surfaces. Mirrors the docs' `--ifm-color-primary`, which flips the same way.
   */
  link: string;
  accent: string;
  /** Page background — the dominant neutral. */
  bg: string;
  /** Raised surface (cards, header). */
  surface: string;
  /** Secondary surface (hover, zebra rows, insets, inputs, code). */
  surfaceAlt: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  borderStrong: string;
  /** Foreground on a brand/semantic-filled surface — always the near-black text (never white). */
  onBrand: string;
  danger: string;
  dangerHover: string;
  success: string;
  warning: string;
  warningHover: string;
  info: string;
  status: typeof tokens.color.status;
}

export interface Theme {
  mode: 'light' | 'dark';
  color: ThemeColor;
  radii: typeof tokens.radii;
  shadow: typeof tokens.shadow;
  motion: typeof tokens.motion;
  zIndex: typeof tokens.zIndex;
  breakpoints: typeof tokens.breakpoints;
  font: { family: string; mono: string; display: string };
  /** 4px spacing scale → px string, e.g. `space(2)` → "8px". */
  space: (n: number) => string;
}

const shared = {
  radii: tokens.radii,
  shadow: tokens.shadow,
  motion: tokens.motion,
  zIndex: tokens.zIndex,
  breakpoints: tokens.breakpoints,
  font: {
    family: typography.fontFamily,
    mono: typography.monoFamily,
    display: typography.displayFontFamily,
  },
  space: (n: number): string => `${tokens.spacing(n)}px`,
} as const;

const semantic = {
  brand: tokens.color.brand,
  brandHover: tokens.color.brandHover,
  accent: tokens.color.accent,
  onBrand: tokens.color.textLight, // dark text on the muted green/semantic fills (WCAG AA)
  danger: tokens.color.danger,
  dangerHover: tokens.color.dangerHover,
  success: tokens.color.brand,
  warning: tokens.color.warning,
  warningHover: tokens.color.warningHover,
  info: tokens.color.info,
  status: tokens.color.status,
} as const;

export const lightTheme: Theme = {
  mode: 'light',
  color: {
    ...semantic,
    brandSolid: tokens.color.brand, // lighter green fill; darkens on hover
    brandSolidHover: tokens.color.brandHover,
    link: tokens.color.brandHover, // darker green — AA on light surfaces
    bg: tokens.color.bgLight,
    surface: tokens.color.surfaceLight,
    surfaceAlt: tokens.color.secondary,
    text: tokens.color.textLight,
    textMuted: 'rgba(27,31,29,0.68)',
    textFaint: 'rgba(27,31,29,0.5)',
    border: tokens.color.secondary,
    borderStrong: '#C9D1CB',
  },
  ...shared,
};

export const darkTheme: Theme = {
  mode: 'dark',
  color: {
    ...semantic,
    brandSolid: tokens.color.brandHover, // darker green fill on dark surfaces; lightens on hover
    brandSolidHover: tokens.color.brand,
    link: tokens.color.brand, // lighter green — legible on dark surfaces
    bg: tokens.color.bgDark,
    surface: tokens.color.surfaceDark,
    surfaceAlt: '#272D2A',
    text: tokens.color.textDark,
    textMuted: 'rgba(237,239,236,0.68)',
    textFaint: 'rgba(237,239,236,0.5)',
    border: '#2C332F',
    borderStrong: '#3A423D',
  },
  ...shared,
};

export const themes = { light: lightTheme, dark: darkTheme } as const;
