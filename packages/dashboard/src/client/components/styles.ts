/**
 * Shared styles via antd-style `createStyles` (build_plan/14.2 — the AntD-recommended
 * CSS-in-JS). Encodes the modern design language: soft shadows, rounded surfaces, subtle
 * header glass, reduced-motion-aware transitions.
 */
import { createStyles } from 'antd-style';
import { tokens } from '@portqueue/ui';

export const useStyles = createStyles(({ token, css }) => ({
  appShell: css`
    min-height: 100vh;
    background: ${token.colorBgLayout};
  `,
  header: css`
    position: sticky;
    top: 0;
    z-index: ${tokens.zIndex.header};
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 clamp(12px, 3vw, 28px);
    height: 60px;
    backdrop-filter: saturate(180%) blur(12px);
    background: ${token.colorBgContainer}cc;
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  headerSpacer: css`
    flex: 1 1 auto;
  `,
  content: css`
    max-width: 1280px;
    margin: 0 auto;
    padding: clamp(16px, 3vw, 32px);
    width: 100%;
  `,
  card: css`
    border-radius: ${tokens.radii.lg}px;
    box-shadow: ${tokens.shadow.sm};
    border: none;
    transition: box-shadow ${tokens.motion.base};
    &:hover {
      box-shadow: ${tokens.shadow.md};
    }
    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  kpiValue: css`
    font-size: 28px;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.02em;
  `,
  kpiLabel: css`
    font-size: 13px;
    color: ${token.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `,
  mono: css`
    font-family: ${'"JetBrains Mono", ui-monospace, Menlo, monospace'};
    font-size: 12px;
  `,
  hero: css`
    border-radius: ${tokens.radii.lg}px;
    padding: clamp(20px, 4vw, 40px);
    background: linear-gradient(135deg, ${tokens.color.brand}18, ${tokens.color.accent}12);
    box-shadow: ${tokens.shadow.sm};
  `,
  pausedBanner: css`
    border-radius: ${tokens.radii.md}px;
    background: ${tokens.color.status.RETRY}22;
    color: ${token.colorText};
    padding: 8px 14px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  `,
}));
