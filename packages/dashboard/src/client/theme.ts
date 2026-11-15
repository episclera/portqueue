/**
 * The dashboard's theme: `@portqueue/theme`'s tokens mapped onto antd's theme config, plus the
 * light/dark preference the visitor owns.
 *
 * antd renders every component; this file is the only place that decides what they look like, so a
 * palette change is a `tokens.json` edit and nothing here. Two brand rules need explicit wiring
 * because antd's defaults contradict them:
 * - **text on a brand fill is the near-black text colour, never white** — antd paints primary
 *   buttons with `colorTextLightSolid`, so the Button tokens below override it;
 * - **the green that fills is not the green that reads** — interactive text (links, focus, the
 *   selected menu item) takes `link`, the darker green on light surfaces and the lighter one on
 *   dark, while a primary button takes `brandSolid`.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { theme as antdTheme, type ThemeConfig } from 'antd';
import { tokens, type ThemeMode } from '@portqueue/theme';

export type { ThemeMode };

/** What the visitor picked: one of the two themes, or "follow the OS". */
export type ThemePreference = ThemeMode | 'system';

const STORAGE_KEY = 'portqueue-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const matches = (query: string): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia(query).matches;

/** antd's theme config for one mode, built from the shared tokens. */
export function themeConfig(mode: ThemeMode, reducedMotion = false): ThemeConfig {
  const c = tokens.modes[mode];
  const p = tokens.palette;
  return {
    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: c.link,
      colorLink: c.link,
      colorInfo: c.infoText,
      colorSuccess: tokens.status.COMPLETED,
      colorWarning: p.warningHover,
      colorError: p.dangerHover,
      colorBgLayout: c.bg,
      colorBgContainer: c.surface,
      colorBgElevated: c.surface,
      colorBgMask: c.overlay,
      colorText: c.text,
      colorTextSecondary: c.textMuted,
      colorTextTertiary: c.textFaint,
      colorBorder: c.borderStrong,
      colorBorderSecondary: c.border,
      colorFillAlter: c.surfaceAlt,
      fontFamily: tokens.font.body,
      fontFamilyCode: tokens.font.mono,
      fontSize: tokens.fontSize.md,
      borderRadius: tokens.radius.md,
      borderRadiusSM: tokens.radius.sm,
      borderRadiusLG: tokens.radius.lg,
      boxShadow: tokens.shadow.md,
      boxShadowSecondary: tokens.shadow.lg,
      motionEaseInOut: tokens.motion.easing,
      motionDurationFast: `${tokens.motion.fastMs}ms`,
      motionDurationMid: `${tokens.motion.baseMs}ms`,
      motionDurationSlow: `${tokens.motion.slowMs}ms`,
      motion: !reducedMotion,
    },
    components: {
      Button: {
        colorPrimary: c.brandSolid,
        colorPrimaryHover: c.brandSolidHover,
        colorPrimaryActive: c.brandSolidHover,
        primaryColor: c.onBrand,
        primaryShadow: 'none',
      },
      Layout: {
        headerBg: c.surface,
        siderBg: c.surface,
        bodyBg: c.bg,
        headerHeight: 60,
        headerPadding: `0 ${tokens.space[4]}px`,
      },
      Menu: {
        itemBg: c.surface,
        itemSelectedColor: c.link,
      },
      Table: {
        // Every table sits edge to edge inside a card, which already rounds the frame; a rounded
        // header row inside it would leave notches at the card's straight inner edges.
        headerBorderRadius: 0,
      },
    },
  };
}

/**
 * The visitor's theme: a stored choice over the OS preference, which it follows live until they
 * pick one. A real OS switch clears the stored choice, so the dashboard goes back to tracking the
 * system rather than pinning a theme the visitor set months ago.
 *
 * Also mirrors the effective mode onto `<html data-theme>`, which is what `@portqueue/theme`'s
 * CSS variables key their dark values on — the same attribute Docusaurus sets on the docs site.
 */
export function useThemeMode(): {
  effective: ThemeMode;
  reducedMotion: boolean;
  setMode: (mode: ThemePreference) => void;
} {
  const [mode, setModeState] = useState<ThemePreference>(() => {
    if (typeof localStorage === 'undefined') return 'system';
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  });
  const [systemDark, setSystemDark] = useState(() => matches(DARK_QUERY));
  const [reducedMotion] = useState(() => matches(REDUCED_MOTION_QUERY));

  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent): void => {
      setSystemDark(e.matches);
      setModeState('system');
      localStorage.removeItem(STORAGE_KEY);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const effective: ThemeMode = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  // Before paint, so a dark-mode visitor never sees a light frame.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = effective;
  }, [effective]);

  const setMode = (next: ThemePreference): void => {
    setModeState(next);
    if (typeof localStorage === 'undefined') return;
    if (next === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  };

  return { effective, reducedMotion, setMode };
}
