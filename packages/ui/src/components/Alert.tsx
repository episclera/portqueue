import React from 'react';
import styled from 'styled-components';
import type { DefaultTheme } from 'styled-components';
import { ErrorIcon, InfoIcon, SuccessIcon, WarningIcon } from '../icons';

export type AlertType = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  type?: AlertType;
  title?: React.ReactNode;
  message?: React.ReactNode;
  showIcon?: boolean;
  action?: React.ReactNode;
  children?: React.ReactNode;
}

const ICONS: Record<AlertType, React.ComponentType> = {
  info: InfoIcon,
  success: SuccessIcon,
  warning: WarningIcon,
  error: ErrorIcon,
};

/** The banner's tint and its icon are the same semantic colour, at different strengths. */
const TONE: Record<AlertType, (t: DefaultTheme) => string> = {
  info: (t) => t.color.info,
  success: (t) => t.color.success,
  warning: (t) => t.color.warning,
  error: (t) => t.color.danger,
};

const Root = styled.div<{ $type: AlertType }>`
  display: flex;
  align-items: flex-start;
  gap: ${(p) => p.theme.space(3)};
  padding: ${(p) => p.theme.space(3)} ${(p) => p.theme.space(4)};
  border-radius: ${(p) => p.theme.radii.md}px;
  color: ${(p) => p.theme.color.text};
  font-size: 14px;
  line-height: 1.5;
  /* The same semantic colour as the icon, at 12% — a hint of tint, never a fill. */
  background: ${(p) => TONE[p.$type](p.theme)}1f;
`;

const Icon = styled.span<{ $type: AlertType }>`
  flex: 0 0 auto;
  display: inline-flex;
  font-size: 16px;
  line-height: 1.4;
  /* The glyph carries the semantic colour; the banner behind it only hints at it. */
  color: ${(p) => TONE[p.$type](p.theme)};
`;

const Content = styled.div`
  flex: 1 1 auto;
  min-width: 0;
`;

const Title = styled.div`
  font-weight: 700;
  margin-bottom: ${(p) => p.theme.space(1)};
`;

const Message = styled.div`
  color: ${(p) => p.theme.color.textMuted};
`;

const Action = styled.div`
  flex: 0 0 auto;
  margin-left: ${(p) => p.theme.space(2)};
`;

/** Tinted banner keyed by `type`, with an icon, optional title/message and a right-side action. */
export function Alert({
  type = 'info',
  title,
  message,
  showIcon = true,
  action,
  children,
}: AlertProps): React.ReactElement {
  const body = children ?? message;
  const TypeIcon = ICONS[type];
  return (
    <Root $type={type} role="alert">
      {showIcon ? (
        <Icon $type={type} aria-hidden>
          <TypeIcon />
        </Icon>
      ) : null}
      <Content>
        {title !== undefined ? <Title>{title}</Title> : null}
        {body !== undefined && body !== null ? <Message>{body}</Message> : null}
      </Content>
      {action !== undefined ? <Action>{action}</Action> : null}
    </Root>
  );
}
