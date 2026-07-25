import React, { useEffect, useState } from 'react';
import { useTheme } from 'styled-components';
import { IconButton } from './IconButton';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeSwitcherProps {
  onChange: (mode: ThemeMode) => void;
}

const STORAGE_KEY = 'portqueue-theme';

/**
 * One-button theme toggle: the icon shows the theme in effect and pressing it flips to the
 * other one (which also clears a "system" preference).
 */
export function ThemeSwitcher({ onChange }: ThemeSwitcherProps): React.ReactElement {
  const theme = useTheme();
  const dark = theme?.mode === 'dark';
  const next: ThemeMode = dark ? 'light' : 'dark';
  return (
    <IconButton
      size="sm"
      onClick={() => onChange(next)}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
    >
      <span aria-hidden>{dark ? '🌙' : '☀️'}</span>
    </IconButton>
  );
}

/**
 * Resolves the effective theme, following the OS preference by default and resetting a
 * manual override back to "system" when the OS theme changes.
 */
export function useThemeMode(): {
  mode: ThemeMode;
  effective: 'light' | 'dark';
  setMode: (m: ThemeMode) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof localStorage === 'undefined') return 'system';
    return (localStorage.getItem(STORAGE_KEY) as ThemeMode) ?? 'system';
  });
  const [systemDark, setSystemDark] = useState<boolean>(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemDark(e.matches);
      // A real OS switch clears any manual override so we track the system again.
      setModeState('system');
      localStorage.removeItem(STORAGE_KEY);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    if (typeof localStorage !== 'undefined') {
      if (m === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, m);
    }
  };

  const effective = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
  return { mode, effective, setMode };
}
