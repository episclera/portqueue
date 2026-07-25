import styled, { css } from 'styled-components';

type TitleLevel = 1 | 2 | 3 | 4 | 5;

const LEVEL: Record<TitleLevel, { fs: number; fw: number; lh: number }> = {
  1: { fs: 34, fw: 800, lh: 1.15 },
  2: { fs: 26, fw: 800, lh: 1.2 },
  3: { fs: 20, fw: 700, lh: 1.25 },
  4: { fs: 16, fw: 700, lh: 1.3 },
  5: { fs: 14, fw: 700, lh: 1.35 },
};

/** Heading. `level` maps to size/weight; renders a semantic `h{level}` via `as`. */
export const Title = styled.h2<{ level?: TitleLevel }>`
  margin: 0;
  color: ${(p) => p.theme.color.text};
  letter-spacing: -0.02em;
  font-size: ${(p) => LEVEL[p.level ?? 2].fs}px;
  font-weight: ${(p) => LEVEL[p.level ?? 2].fw};
  line-height: ${(p) => LEVEL[p.level ?? 2].lh};
`;

export type TextTone = 'default' | 'muted' | 'faint' | 'brand' | 'danger' | 'success';

const tone = (t: TextTone) =>
  ({
    default: css`
      color: ${(p) => p.theme.color.text};
    `,
    muted: css`
      color: ${(p) => p.theme.color.textMuted};
    `,
    faint: css`
      color: ${(p) => p.theme.color.textFaint};
    `,
    brand: css`
      color: ${(p) => p.theme.color.brand};
    `,
    danger: css`
      color: ${(p) => p.theme.color.danger};
    `,
    success: css`
      color: ${(p) => p.theme.color.success};
    `,
  })[t];

/** Inline text with a tone and optional strong/small styling. */
export const Text = styled.span<{ $tone?: TextTone; $strong?: boolean; $small?: boolean }>`
  ${(p) => tone(p.$tone ?? 'default')}
  font-weight: ${(p) => (p.$strong ? 600 : 400)};
  font-size: ${(p) => (p.$small ? '12.5px' : 'inherit')};
`;

/** Block paragraph with comfortable measure and muted tone by default. */
export const Paragraph = styled.p<{ $tone?: TextTone }>`
  margin: 0 0 ${(p) => p.theme.space(3)};
  line-height: 1.6;
  ${(p) => tone(p.$tone ?? 'muted')}
`;

/** Inline monospace code token. */
export const Code = styled.code`
  font-family: ${(p) => p.theme.font.mono};
  font-size: 0.9em;
  padding: 1px 6px;
  border-radius: ${(p) => p.theme.radii.sm}px;
  background: ${(p) => p.theme.color.surfaceAlt};
  border: 1px solid ${(p) => p.theme.color.border};
`;

/** Undecorated monospace text — ids, keys, patterns. */
export const Mono = styled.span`
  font-family: ${(p) => p.theme.font.mono};
  font-size: 12px;
`;
