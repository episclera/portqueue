import React from 'react';
import { tokens } from '../theme/tokens.js';
import { typography } from '../theme/typography.js';

export interface LogoProps {
  /** 'full' = mark + wordmark; 'mark' = icon only; 'mono' = single-color. */
  variant?: 'full' | 'mark' | 'mono';
  size?: number;
  color?: string;
}

/**
 * The PortQueue brand mark — an abstract cargo ship seen head-on, sitting on the water:
 * a trapezoid hull with stacked deck containers above calm waves. Theme-aware via
 * `currentColor`; containers use the brand/accent colours unless `mono`.
 */
export function Logo({ variant = 'full', size = 32, color }: LogoProps): React.ReactElement {
  const accent = variant === 'mono' ? 'currentColor' : tokens.color.accent;
  const brand = variant === 'mono' ? 'currentColor' : tokens.color.brand;
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="PortQueue"
      style={{ color: color ?? 'currentColor', flex: '0 0 auto' }}
    >
      {/* Water: calm waves the ship sits on. */}
      <path
        d="M6 37 q3.6 -2.4 7.2 0 t7.2 0 t7.2 0 t7.2 0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        opacity={0.55}
      />
      <path
        d="M5 41 q3.6 -2.4 7.2 0 t7.2 0 t7.2 0 t7.2 0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        opacity={0.32}
      />
      {/* Cargo ship, front view: trapezoid hull. */}
      <path d="M11 28 L37 28 L32 36 L16 36 Z" fill="currentColor" opacity={0.9} />
      {/* Stacked deck containers. */}
      <rect x="14" y="16" width="6" height="5" rx="1.2" fill={brand} />
      <rect x="21" y="16" width="6" height="5" rx="1.2" fill={accent} />
      <rect x="28" y="16" width="6" height="5" rx="1.2" fill={brand} />
      <rect x="14" y="22" width="6" height="5" rx="1.2" fill={accent} />
      <rect x="21" y="22" width="6" height="5" rx="1.2" fill={brand} />
      <rect x="28" y="22" width="6" height="5" rx="1.2" fill={accent} />
    </svg>
  );

  if (variant === 'mark' || variant === 'mono') return mark;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {mark}
      <span
        style={{
          fontFamily: typography.displayFontFamily,
          fontWeight: 700,
          fontSize: size * 0.6,
          letterSpacing: '-0.02em',
          color: color ?? 'currentColor',
        }}
      >
        Port<span style={{ color: tokens.color.brand }}>Queue</span>
      </span>
    </span>
  );
}
