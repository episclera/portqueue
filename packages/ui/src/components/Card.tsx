import React from 'react';
import styled from 'styled-components';

const CardRoot = styled.section<{ $interactive: boolean; $pad: boolean }>`
  background: ${(p) => p.theme.color.surface};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radii.lg}px;
  box-shadow: ${(p) => p.theme.shadow.sm};
  overflow: hidden;
  ${(p) => (p.$pad ? `padding: ${p.theme.space(5)};` : '')}
  transition: box-shadow ${(p) => p.theme.motion.base}, transform ${(p) => p.theme.motion.base};
  ${(p) =>
    p.$interactive
      ? `&:hover { box-shadow: ${p.theme.shadow.md}; transform: translateY(-1px); }`
      : ''}
`;

const HeaderRow = styled.header`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(3)};
  padding: ${(p) => p.theme.space(4)} ${(p) => p.theme.space(5)};
  border-bottom: 1px solid ${(p) => p.theme.color.border};
`;

const HeaderTitles = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
`;

const HeaderTitle = styled.h3`
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: ${(p) => p.theme.color.text};
  letter-spacing: -0.01em;
`;

const HeaderSubtitle = styled.p`
  margin: 0;
  font-size: 13px;
  color: ${(p) => p.theme.color.textMuted};
`;

const HeaderExtra = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(2)};
`;

const Body = styled.div<{ $pad: boolean }>`
  ${(p) => (p.$pad ? `padding: ${p.theme.space(5)};` : '')}
`;

export interface CardHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Trailing content (actions, badges). */
  extra?: React.ReactNode;
  /** Leading emoji icon. */
  icon?: React.ReactNode;
}

/** Header band for a Card: title + optional subtitle, leading icon, and trailing extra. */
export function CardHeader({ title, subtitle, extra, icon }: CardHeaderProps): React.ReactElement {
  return (
    <HeaderRow>
      {icon ? (
        <span aria-hidden style={{ fontSize: 20 }}>
          {icon}
        </span>
      ) : null}
      <HeaderTitles>
        <HeaderTitle>{title}</HeaderTitle>
        {subtitle ? <HeaderSubtitle>{subtitle}</HeaderSubtitle> : null}
      </HeaderTitles>
      {extra ? <HeaderExtra>{extra}</HeaderExtra> : null}
    </HeaderRow>
  );
}

export interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** Convenience header; omit and compose `CardHeader`/`CardBody` for full control. */
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  extra?: React.ReactNode;
  icon?: React.ReactNode;
  interactive?: boolean;
  /** Pad the body. Default true when using `title`; set false for flush content (tables). */
  bodyPadding?: boolean;
}

/** Surface container. With `title` it renders a header + padded body; otherwise a plain padded surface. */
export const Card = React.forwardRef<HTMLElement, CardProps>(function Card(
  { title, subtitle, extra, icon, interactive = false, bodyPadding = true, children, ...rest },
  ref,
): React.ReactElement {
  if (title !== undefined || subtitle !== undefined || extra !== undefined) {
    return (
      <CardRoot ref={ref} $interactive={interactive} $pad={false} {...rest}>
        <CardHeader title={title} subtitle={subtitle} extra={extra} icon={icon} />
        <Body $pad={bodyPadding}>{children}</Body>
      </CardRoot>
    );
  }
  return (
    <CardRoot ref={ref} $interactive={interactive} $pad={bodyPadding} {...rest}>
      {children}
    </CardRoot>
  );
});

/** Body region for a manually-composed Card. */
export function CardBody({
  padding = true,
  children,
}: {
  padding?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return <Body $pad={padding}>{children}</Body>;
}

/** A lighter inset surface for grouping content inside a page or card. */
export const Panel = styled.div`
  background: ${(p) => p.theme.color.surfaceAlt};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radii.md}px;
  padding: ${(p) => p.theme.space(4)};
`;
