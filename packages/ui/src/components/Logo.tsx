import React from 'react';
import { tokens } from '../theme/tokens';
import { typography } from '../theme/typography';

export interface LogoProps {
  /** 'full' = mark + wordmark; 'mark' = icon only; 'mono' = single-color icon. */
  variant?: 'full' | 'mark' | 'mono';
  size?: number;
  color?: string;
}

/**
 * The PortQueue brand mark — the docs site's artwork (`docs/static/img/logo.svg`): a rounded
 * green tile carrying a cargo ship seen head-on, a trapezoid hull with stacked deck
 * containers. `mono` swaps the tile for `currentColor` so it works on any background.
 */
export function Logo({ variant = 'full', size = 32, color }: LogoProps): React.ReactElement {
  // Unique per instance so several logos on one page can't share a gradient id.
  const gradientId = `pq-logo-${React.useId()}`;
  const mono = variant === 'mono';
  const tile = mono ? 'currentColor' : `url(#${gradientId})`;
  const hull = mono ? tokens.color.surfaceLight : tokens.color.textLight;
  const containerLight = mono ? tokens.color.surfaceLight : '#F2F3F1';
  const containerDim = mono ? tokens.color.surfaceLight : '#DDE3DE';

  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label="PortQueue"
      style={{ color: color ?? 'currentColor', flex: '0 0 auto' }}
    >
      {!mono && (
        <defs>
          <linearGradient
            id={gradientId}
            x1="0"
            y1="0"
            x2="40"
            y2="40"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor={tokens.color.brand} />
            <stop offset="1" stopColor={tokens.color.brandHover} />
          </linearGradient>
        </defs>
      )}
      {/* Rounded tile in the brand green. */}
      <rect x="2" y="2" width="36" height="36" rx="10" fill={tile} />
      {/* Cargo ship, front view: trapezoid hull. */}
      <path d="M9 23 L31 23 L27 30 L13 30 Z" fill={hull} opacity={mono ? 0.75 : 1} />
      {/* Stacked containers on deck. */}
      <rect
        x="11.5"
        y="13.5"
        width="5"
        height="4"
        rx="1"
        fill={containerLight}
        opacity={mono ? 0.9 : 1}
      />
      <rect
        x="17.5"
        y="13.5"
        width="5"
        height="4"
        rx="1"
        fill={containerDim}
        opacity={mono ? 0.6 : 1}
      />
      <rect
        x="23.5"
        y="13.5"
        width="5"
        height="4"
        rx="1"
        fill={containerLight}
        opacity={mono ? 0.9 : 1}
      />
      <rect
        x="11.5"
        y="18"
        width="5"
        height="4"
        rx="1"
        fill={containerDim}
        opacity={mono ? 0.6 : 1}
      />
      <rect
        x="17.5"
        y="18"
        width="5"
        height="4"
        rx="1"
        fill={containerLight}
        opacity={mono ? 0.9 : 1}
      />
      <rect
        x="23.5"
        y="18"
        width="5"
        height="4"
        rx="1"
        fill={containerDim}
        opacity={mono ? 0.6 : 1}
      />
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
        Port<span style={{ color: tokens.color.brandHover }}>Queue</span>
      </span>
    </span>
  );
}
