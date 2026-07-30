import React from 'react';
import clsx from 'clsx';
import useIsBrowser from '@docusaurus/useIsBrowser';
import { useColorMode } from '@docusaurus/theme-common';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import type { Props } from '@theme/ColorModeToggle';
import styles from './styles.module.css';

/**
 * The docs theme switcher, swizzled to behave exactly like the dashboard's (`ThemeSwitcher` in
 * `@portqueue/ui`): one button, the icon shows the theme **in effect**, and pressing it flips to the
 * other one. Docusaurus's stock toggle instead cycles light → dark → system and paints a third
 * "auto" icon for that last state — a three-position control whose current position is a monitor
 * glyph reads as a puzzle rather than a switch, and the dashboard has nothing like it.
 *
 * The site still *opens* on the visitor's OS preference and follows it live
 * (`colorMode.respectPrefersColorScheme` in `docusaurus.config.ts`); pressing the button is what
 * turns that into an explicit, remembered choice. The docs site has no dependency on
 * `@portqueue/ui`, so the behaviour and its two icons are mirrored rather than imported — the same
 * trade-off `src/pages/index.tsx` makes when it reaches for `@ant-design/icons` directly.
 *
 * Both icons are always rendered and CSS picks the visible one off `<html data-theme>`, which is how
 * the correct icon is painted before React hydrates.
 */
function ColorModeToggle({ className, buttonClassName, onChange }: Props): React.ReactElement {
  const isBrowser = useIsBrowser();
  const { colorMode } = useColorMode();
  const next = colorMode === 'dark' ? 'light' : 'dark';
  // Before hydration the effective mode is whatever the server rendered, so the label stays
  // generic rather than naming a theme that may be wrong.
  const label = isBrowser ? `Switch to ${next} theme` : 'Switch theme';
  return (
    <div className={clsx(styles.toggle, className)}>
      <button
        className={clsx(
          'clean-btn',
          styles.toggleButton,
          !isBrowser && styles.toggleButtonDisabled,
          buttonClassName,
        )}
        type="button"
        onClick={() => onChange(next)}
        disabled={!isBrowser}
        title={label}
        aria-label={label}
      >
        <SunOutlined aria-hidden className={clsx(styles.toggleIcon, styles.lightToggleIcon)} />
        <MoonOutlined aria-hidden className={clsx(styles.toggleIcon, styles.darkToggleIcon)} />
      </button>
    </div>
  );
}

export default React.memo(ColorModeToggle);
