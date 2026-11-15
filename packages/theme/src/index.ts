/**
 * `@portqueue/theme` — the PortQueue design tokens, framework-free.
 *
 * Three ways in, all generated from or reading the same `tokens.json`:
 * - `import { tokens } from '@portqueue/theme'` — typed values for JS (the dashboard maps them onto
 *   antd's theme config; the docs read them in MDX and the Docusaurus config).
 * - `import '@portqueue/theme/theme.css'` — the same values as `--pq-*` CSS custom properties, light
 *   by default and dark under `data-theme="dark"`.
 * - `@portqueue/theme/tokens.json` — the raw source, for tooling that is not JavaScript.
 *
 * There are no components here and no React: each surface renders with its own toolkit (antd in the
 * dashboard, Docusaurus/Infima in the docs) and takes only its colours and measurements from this
 * package. See README.md for the usage rules.
 */
import source from './tokens.json';

export type ThemeMode = 'light' | 'dark';

/** The colours that change between light and dark. */
export interface ModeColors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  borderStrong: string;
  /** Foreground on a brand or semantic fill — always the near-black text, never white. */
  onBrand: string;
  /** Primary-button fill and its hover. */
  brandSolid: string;
  brandSolidHover: string;
  /** Interactive text — the darker green on light surfaces, the lighter one on dark. */
  link: string;
  /** Semantic colours deepened enough to read as text on `surface`. */
  infoText: string;
  warningText: string;
  dangerText: string;
  /** The scrim behind a modal or drawer. */
  overlay: string;
}

export type StatusColorKey =
  'PENDING' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'RETRY' | 'CANCELLED' | 'EXPIRED' | 'STALLED';

export interface Tokens {
  /** Mode-independent accents and semantic colours. */
  palette: {
    brand: string;
    brandHover: string;
    accent: string;
    success: string;
    danger: string;
    dangerHover: string;
    warning: string;
    warningHover: string;
    info: string;
  };
  modes: Record<ThemeMode, ModeColors>;
  /** Job-status colours, legible as outline-tag text on either surface. Mirrored by the CLI. */
  status: Record<StatusColorKey, string>;
  /** Pixels. */
  radius: { sm: number; md: number; lg: number; pill: number };
  /** A 4px scale, in pixels: `space[3]` is 12. */
  space: Record<'1' | '2' | '3' | '4' | '5' | '6' | '8' | '10' | '12', number>;
  /** Pixels; `md` is the body size. */
  fontSize: { sm: number; md: number; lg: number; xl: number; xxl: number; display: number };
  font: { body: string; display: string; mono: string };
  lineHeight: number;
  shadow: { sm: string; md: string; lg: string };
  motion: { easing: string; fastMs: number; baseMs: number; slowMs: number };
  /** Minimum widths in pixels. Not CSS variables — `@media` cannot read `var()`. */
  breakpoints: { xs: number; sm: number; md: number; lg: number; xl: number };
}

export const tokens: Tokens = source as Tokens;

/** The colour for a job status, falling back to `PENDING`'s grey for anything unknown. */
export function statusColor(status: string): string {
  return tokens.status[status.toUpperCase() as StatusColorKey] ?? tokens.status.PENDING;
}
