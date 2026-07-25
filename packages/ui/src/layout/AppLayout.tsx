import React from 'react';
import styled from 'styled-components';

/** Full-height application shell — sets the page background, base text colour and font. */
export const AppShell = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: ${(p) => p.theme.color.bg};
  color: ${(p) => p.theme.color.text};
  font-family: ${(p) => p.theme.font.family};
`;

export interface HeaderProps extends React.HTMLAttributes<HTMLElement> {
  /** Content pinned to the left (e.g. logo / brand). */
  left?: React.ReactNode;
  /** Content pinned to the right (e.g. actions, theme toggle). */
  right?: React.ReactNode;
  /** Central content — flexes to fill (e.g. nav, search). */
  children?: React.ReactNode;
}

const StyledHeader = styled.header`
  position: sticky;
  top: 0;
  z-index: ${(p) => p.theme.zIndex.header};
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(4)};
  height: 60px;
  padding: 0 clamp(12px, 3vw, 28px);
  background: ${(p) => p.theme.color.surface};
  border-bottom: 1px solid ${(p) => p.theme.color.border};
`;

const HeaderSlot = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(2)};
  flex: none;
`;

const HeaderCenter = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(2)};
  flex: 1;
  min-width: 0;
`;

/** Sticky, opaque top bar with left / center / right slots. Shared by dashboard + docs. */
export const Header = React.forwardRef<HTMLElement, HeaderProps>(function Header(
  { left, right, children, ...rest },
  ref,
): React.ReactElement {
  return (
    <StyledHeader ref={ref} {...rest}>
      {left != null ? <HeaderSlot>{left}</HeaderSlot> : null}
      <HeaderCenter>{children}</HeaderCenter>
      {right != null ? <HeaderSlot>{right}</HeaderSlot> : null}
    </StyledHeader>
  );
});

/** The single page gutter, shared by the content column and the subheader band. */
const PAGE_GUTTER = 'clamp(16px, 2vw, 24px)';

/** Content column — spans the full available width with responsive padding. */
export const Content = styled.main`
  width: 100%;
  padding: ${PAGE_GUTTER};
`;

/** Muted, centered footer with a top border. */
export const Footer = styled.footer`
  margin-top: auto;
  padding: ${(p) => p.theme.space(6)} clamp(16px, 3vw, 32px);
  border-top: 1px solid ${(p) => p.theme.color.border};
  color: ${(p) => p.theme.color.textMuted};
  font-size: 13px;
  text-align: center;
`;

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned actions (buttons, links). */
  extra?: React.ReactNode;
}

/**
 * Full-bleed band: title + one-line description on the left, actions hard right on the same
 * row. Rendered as a sibling of `Content` (not inside it) so it spans the whole width.
 */
const PageHeaderRoot = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${(p) => p.theme.space(4)};
  width: 100%;
  padding: ${(p) => p.theme.space(4)} ${PAGE_GUTTER};
  background: ${(p) => p.theme.color.surface};
  border-bottom: 1px solid ${(p) => p.theme.color.border};

  @media (max-width: ${(p) => p.theme.breakpoints.sm}px) {
    flex-direction: column;
    align-items: flex-start;
  }
`;

const PageHeaderText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const PageTitle = styled.h1`
  margin: 0;
  font-family: ${(p) => p.theme.font.display};
  font-size: 20px;
  font-weight: 700;
  line-height: 1.25;
  color: ${(p) => p.theme.color.text};
`;

const PageSubtitle = styled.p`
  margin: 0;
  font-size: 13px;
  color: ${(p) => p.theme.color.textMuted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PageHeaderExtra = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(2)};
  flex: none;
  flex-wrap: wrap;
`;

/** Page subheader band — title, one-line description, and right-aligned actions. */
export const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(function PageHeader(
  { title, subtitle, extra, ...rest },
  ref,
): React.ReactElement {
  return (
    <PageHeaderRoot ref={ref} {...rest}>
      <PageHeaderText>
        <PageTitle>{title}</PageTitle>
        {subtitle != null ? <PageSubtitle>{subtitle}</PageSubtitle> : null}
      </PageHeaderText>
      {extra != null ? <PageHeaderExtra>{extra}</PageHeaderExtra> : null}
    </PageHeaderRoot>
  );
});
