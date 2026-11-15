/**
 * App chrome: a sticky top bar (logo, live-updates control, theme toggle) over a left sidebar of
 * navigation and the routed page. Below the `md` breakpoint the sidebar gives way to a burger
 * button that opens the same navigation in an antd `Drawer` — which brings the focus trap, Escape
 * to close and the scrim that this file used to implement by hand.
 */
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button, Drawer, Flex, Layout, Menu, Tooltip, theme } from 'antd';
import {
  DarkModeIcon,
  DocsIcon,
  GithubIcon,
  InstancesIcon,
  LightModeIcon,
  MenuIcon,
  OverviewIcon,
  SchedulesIcon,
} from '../icons';
import { Logo } from './Logo';
import { useLive } from './LiveProvider';
import { useRefreshAll } from '../queries/use-queries';
import { ACTIONS_CONFIG, LIVE_TOGGLE_CONFIG } from '../constants/labels';
import type { ThemeMode, ThemePreference } from '../theme';
import styles from './Shell.module.css';

export interface ShellProps {
  mode: ThemeMode;
  onThemeChange: (mode: ThemePreference) => void;
  children: React.ReactNode;
}

/** The sidebar's fixed width, in pixels. */
const SIDER_WIDTH = 182;

const NAV_ITEMS: { to: string; label: string; icon: React.ReactNode }[] = [
  { to: '/', label: 'Overview', icon: <OverviewIcon aria-hidden /> },
  { to: '/instances', label: 'Instances', icon: <InstancesIcon aria-hidden /> },
  { to: '/schedules', label: 'Schedules', icon: <SchedulesIcon aria-hidden /> },
];

/**
 * Sidebar footer links — docs site and repository, side by side. GitHub is icon-only (named by its
 * `aria-label` and tooltip): the sidebar is too narrow for two labelled buttons, and the mark is
 * recognisable on its own.
 */
const EXTERNAL_LINKS: { href: string; label: string; icon: React.ReactNode; iconOnly?: boolean }[] =
  [
    {
      href: 'https://episclera.github.io/portqueue/',
      label: 'Docs',
      icon: <DocsIcon aria-hidden />,
    },
    {
      href: 'https://github.com/episclera/portqueue',
      label: 'GitHub',
      icon: <GithubIcon aria-hidden />,
      iconOnly: true,
    },
  ];

/** The nav item a path belongs to: `/` only on the overview itself, a section for its sub-pages. */
function selectedKey(pathname: string): string[] {
  if (pathname === '/') return ['/'];
  const item = NAV_ITEMS.find((i) => i.to !== '/' && pathname.startsWith(i.to));
  return item ? [item.to] : [];
}

/** The navigation itself, rendered in the sidebar on desktop and in the drawer on mobile. */
function Navigation(): React.ReactElement {
  const location = useLocation();
  const { token } = theme.useToken();
  return (
    <Flex component="nav" vertical aria-label="Main navigation" style={{ height: '100%' }}>
      <Menu
        mode="inline"
        selectedKeys={selectedKey(location.pathname)}
        style={{ borderInlineEnd: 0, flex: 1 }}
        items={NAV_ITEMS.map((item) => ({
          key: item.to,
          icon: item.icon,
          label: <Link to={item.to}>{item.label}</Link>,
        }))}
      />
      <Flex
        gap={token.marginXS}
        style={{
          padding: token.paddingSM,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        {EXTERNAL_LINKS.map((link) =>
          link.iconOnly ? (
            <Tooltip key={link.href} title={link.label}>
              <Button
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
                icon={link.icon}
                aria-label={link.label}
              />
            </Tooltip>
          ) : (
            <Button
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer noopener"
              icon={link.icon}
              block
            >
              {link.label}
            </Button>
          ),
        )}
      </Flex>
    </Flex>
  );
}

/** Pause / resume the interval polling, and refresh on demand. */
function LiveToggle(): React.ReactElement {
  const { live, setLive } = useLive();
  const refresh = useRefreshAll();
  const state = live ? LIVE_TOGGLE_CONFIG.live : LIVE_TOGGLE_CONFIG.paused;
  return (
    <Flex gap="small" align="center">
      <Tooltip title={state.hint} placement="bottom">
        <Button
          icon={state.icon}
          onClick={() => setLive(!live)}
          aria-label={`${state.label} auto-updates`}
        >
          {state.label}
        </Button>
      </Tooltip>
      {/* Always offered, not only while paused: wanting the freshest data right now is
          independent of whether the poll interval happens to also be running. */}
      <Tooltip title="Fetch the latest data now" placement="bottom">
        <Button icon={ACTIONS_CONFIG.refresh.icon} onClick={refresh} aria-label="Refresh now" />
      </Tooltip>
    </Flex>
  );
}

/**
 * One-button theme toggle: the icon shows the theme in effect and pressing it flips to the other
 * one — the same control the docs site's navbar carries.
 */
function ThemeToggle({
  mode,
  onChange,
}: {
  mode: ThemeMode;
  onChange: (mode: ThemePreference) => void;
}): React.ReactElement {
  const next: ThemeMode = mode === 'dark' ? 'light' : 'dark';
  return (
    <Button
      type="text"
      icon={mode === 'dark' ? <DarkModeIcon aria-hidden /> : <LightModeIcon aria-hidden />}
      onClick={() => onChange(next)}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
    />
  );
}

export function Shell({ mode, onThemeChange, children }: ShellProps): React.ReactElement {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const { token } = theme.useToken();

  // Navigating closes the mobile drawer.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: token.zIndexPopupBase - 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: token.marginSM,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          lineHeight: 'normal',
        }}
      >
        <Flex align="center" gap="middle">
          <span className={styles.mobileOnly}>
            <Button
              icon={<MenuIcon aria-hidden />}
              aria-label="Toggle navigation"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen((open) => !open)}
            />
          </span>
          <Link to="/" aria-label="Home" style={{ display: 'inline-flex', color: 'inherit' }}>
            <Logo variant="full" size={30} />
          </Link>
        </Flex>
        <Flex align="center" gap="small">
          <LiveToggle />
          <ThemeToggle mode={mode} onChange={onThemeChange} />
        </Flex>
      </Layout.Header>

      <Layout hasSider>
        <Layout.Sider
          width={SIDER_WIDTH}
          className={styles.desktopOnly}
          style={{
            position: 'sticky',
            top: 60,
            height: 'calc(100vh - 60px)',
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            overflowY: 'auto',
          }}
        >
          <Navigation />
        </Layout.Sider>
        <Layout.Content style={{ minWidth: 0 }}>{children}</Layout.Content>
      </Layout>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        placement="left"
        size={SIDER_WIDTH + 58}
        title={<Logo variant="full" size={26} />}
        styles={{ body: { padding: 0 } }}
      >
        <Navigation />
      </Drawer>
    </Layout>
  );
}
