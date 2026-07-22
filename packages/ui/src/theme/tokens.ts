/**
 * Design tokens shared by the docs site and dashboard. Encodes the
 * modern design language: spacious spacing scale, soft elevation over hard borders,
 * rounded surfaces, a restrained accent palette, and motion tokens.
 */
export const tokens = {
  color: {
    // Brand accent — a calm indigo/teal blend suggesting flow through a port.
    brand: '#4f46e5',
    brandHover: '#6366f1',
    accent: '#0ea5e9',
    // Neutral fields (content-first, large flat neutrals).
    bgLight: '#f7f8fa',
    surfaceLight: '#ffffff',
    bgDark: '#0b0e14',
    surfaceDark: '#131722',
    textLight: '#1a1d23',
    textDark: '#e6e8ec',
    // Semantic job-status colors (single source of truth; mirrored by the CLI).
    status: {
      PENDING: '#94a3b8',
      ACTIVE: '#06b6d4',
      COMPLETED: '#22c55e',
      FAILED: '#ef4444',
      RETRY: '#f59e0b',
      CANCELLED: '#9ca3af',
      EXPIRED: '#9ca3af',
      STALLED: '#d946ef',
    },
  },
  radii: { sm: 6, md: 10, lg: 16, pill: 999 },
  spacing: (n: number): number => n * 4, // 4px base scale
  shadow: {
    sm: '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)',
    md: '0 4px 12px rgba(16,24,40,0.08), 0 2px 6px rgba(16,24,40,0.06)',
    lg: '0 12px 32px rgba(16,24,40,0.12), 0 6px 16px rgba(16,24,40,0.08)',
  },
  zIndex: { header: 100, drawer: 200, modal: 300, toast: 400 },
  breakpoints: { xs: 480, sm: 640, md: 768, lg: 1024, xl: 1280 },
  motion: {
    fast: '120ms cubic-bezier(0.4, 0, 0.2, 1)',
    base: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '320ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
} as const;

export type StatusColorKey = keyof typeof tokens.color.status;
