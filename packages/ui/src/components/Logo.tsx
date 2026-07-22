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
 * The PortQueue brand mark (build_plan/14.5) — an AI-authored, hand-editable SVG. A rounded
 * gateway (the "port") with an ordered set of queued units flowing through it. Theme-aware
 * via `currentColor`; the accent stripe uses the brand color unless `mono`.
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
      {/* The port: a rounded gateway. */}
      <rect
        x="4"
        y="6"
        width="40"
        height="36"
        rx="11"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.9"
      />
      {/* Ordered queued units flowing in, decreasing to suggest draining. */}
      <rect x="12" y="15" width="24" height="4.5" rx="2.25" fill={brand} />
      <rect x="12" y="22" width="18" height="4.5" rx="2.25" fill={accent} />
      <rect x="12" y="29" width="12" height="4.5" rx="2.25" fill={brand} opacity="0.7" />
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
