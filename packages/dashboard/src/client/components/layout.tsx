/**
 * The page frame every route renders inside the shell: a full-width subheader band (title, one-line
 * description, right-aligned actions) over the page's content.
 *
 * antd has no page-header component, so this is the one composition the dashboard keeps for page
 * layout — built from antd's `Flex` and `Typography` and themed by the same tokens.
 */
import React from 'react';
import { Flex, Typography, theme } from 'antd';

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned actions (buttons, menus). */
  extra?: React.ReactNode;
}

export function PageHeader({ title, subtitle, extra }: PageHeaderProps): React.ReactElement {
  const { token } = theme.useToken();
  return (
    <Flex
      component="header"
      justify="space-between"
      align="center"
      gap={token.marginSM}
      wrap
      style={{
        padding: `${token.paddingMD}px ${token.paddingLG}px`,
        background: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Flex vertical gap={token.marginXXS} style={{ minWidth: 0 }}>
        {typeof title === 'string' ? (
          <Typography.Title level={3} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
        ) : (
          title
        )}
        {subtitle != null ? <Typography.Text type="secondary">{subtitle}</Typography.Text> : null}
      </Flex>
      {extra != null ? <div>{extra}</div> : null}
    </Flex>
  );
}

/** The content column under a page header — full width, padded, children stacked. */
export function PageBody({ children }: { children: React.ReactNode }): React.ReactElement {
  const { token } = theme.useToken();
  return (
    <Flex vertical gap={token.marginMD} style={{ padding: token.paddingLG }}>
      {children}
    </Flex>
  );
}
