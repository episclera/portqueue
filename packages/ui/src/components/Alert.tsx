import React from 'react';
import styled, { css } from 'styled-components';

export type AlertType = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  type?: AlertType;
  title?: React.ReactNode;
  message?: React.ReactNode;
  showIcon?: boolean;
  action?: React.ReactNode;
  children?: React.ReactNode;
}

const ICONS: Record<AlertType, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '⛔',
};

const typeStyles = (type: AlertType): ReturnType<typeof css> => {
  switch (type) {
    case 'success':
      return css`
        background: ${(p) => p.theme.color.success}1f;
        border-left-color: ${(p) => p.theme.color.success};
      `;
    case 'warning':
      return css`
        background: ${(p) => p.theme.color.warning}1f;
        border-left-color: ${(p) => p.theme.color.warning};
      `;
    case 'error':
      return css`
        background: ${(p) => p.theme.color.danger}1f;
        border-left-color: ${(p) => p.theme.color.danger};
      `;
    default:
      return css`
        background: ${(p) => p.theme.color.info}1f;
        border-left-color: ${(p) => p.theme.color.info};
      `;
  }
};

const Root = styled.div<{ $type: AlertType }>`
  display: flex;
  align-items: flex-start;
  gap: ${(p) => p.theme.space(3)};
  padding: ${(p) => p.theme.space(3)} ${(p) => p.theme.space(4)};
  border-radius: ${(p) => p.theme.radii.md}px;
  border-left: 3px solid transparent;
  color: ${(p) => p.theme.color.text};
  font-size: 14px;
  line-height: 1.5;
  ${(p) => typeStyles(p.$type)}
`;

const Icon = styled.span`
  flex: 0 0 auto;
  font-size: 16px;
  line-height: 1.4;
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

/** Tinted banner keyed by `type`, with an emoji icon, optional title/message and a right-side action. */
export function Alert({
  type = 'info',
  title,
  message,
  showIcon = true,
  action,
  children,
}: AlertProps): React.ReactElement {
  const body = children ?? message;
  return (
    <Root $type={type} role="alert">
      {showIcon ? <Icon aria-hidden>{ICONS[type]}</Icon> : null}
      <Content>
        {title !== undefined ? <Title>{title}</Title> : null}
        {body !== undefined && body !== null ? <Message>{body}</Message> : null}
      </Content>
      {action !== undefined ? <Action>{action}</Action> : null}
    </Root>
  );
}
