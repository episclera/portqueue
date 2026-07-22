import React, { useEffect, useState } from 'react';
import { Segmented } from 'antd';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeSwitcherProps {
  value: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

const STORAGE_KEY = 'portqueue-theme';

/** Light/dark/system switcher. */
export function ThemeSwitcher({ value, onChange }: ThemeSwitcherProps): React.ReactElement {
  return (
    <Segmented
      size="small"
      value={value}
      onChange={(v) => onChange(v as ThemeMode)}
      options={[
        { label: 'Light', value: 'light' },
        { label: 'Dark', value: 'dark' },
        { label: 'System', value: 'system' },
      ]}
    />
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
