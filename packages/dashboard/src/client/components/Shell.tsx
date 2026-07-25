/**
 * App chrome: a top bar (logo, live-updates control, theme toggle) over a left sidebar of
 * navigation items and the routed page. Below the `md` breakpoint the sidebar collapses behind
 * a burger button and opens as an overlay drawer.
 */
import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import {
  AppShell,
  Button,
  Header,
  Inline,
  Logo,
  Text,
  ThemeSwitcher,
  Tooltip,
  type ThemeMode,
} from '@portqueue/ui';
import { config } from '../queries/api';
import { useLive } from './LiveProvider';
import { ACTIONS_CONFIG, LIVE_TOGGLE_CONFIG } from '../constants/labels';

export interface ShellProps {
  onThemeChange: (mode: ThemeMode) => void;
  children: React.ReactNode;
}

interface NavItem {
  to: string;
  label: string;
  icon: string;
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: '📊', exact: true },
  { to: '/instances', label: 'Instances', icon: '🖥️' },
  { to: '/schedules', label: 'Schedules', icon: '🗓️' },
];

const HEADER_HEIGHT = 60;
const SIDEBAR_WIDTH = 232;

const Body = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
`;

const Nav = styled.nav<{ $open: boolean }>`
  flex: 0 0 ${SIDEBAR_WIDTH}px;
  width: ${SIDEBAR_WIDTH}px;
  align-self: flex-start;
  position: sticky;
  top: ${HEADER_HEIGHT}px;
  height: calc(100vh - ${HEADER_HEIGHT}px);
  padding: ${(p) => p.theme.space(4)} ${(p) => p.theme.space(3)};
  background: ${(p) => p.theme.color.surface};
  border-right: 1px solid ${(p) => p.theme.color.border};
  overflow-y: auto;

  @media (max-width: ${(p) => p.theme.breakpoints.md}px) {
    position: fixed;
    left: 0;
    z-index: ${(p) => p.theme.zIndex.drawer};
    box-shadow: ${(p) => p.theme.shadow.lg};
    transform: translateX(${(p) => (p.$open ? '0' : '-100%')});
    transition: transform ${(p) => p.theme.motion.base};
  }
`;

const Scrim = styled.div`
  display: none;

  @media (max-width: ${(p) => p.theme.breakpoints.md}px) {
    display: block;
    position: fixed;
    inset: ${HEADER_HEIGHT}px 0 0 0;
    z-index: ${(p) => p.theme.zIndex.drawer - 1};
    background: rgba(9, 12, 18, 0.4);
  }
`;

const NavList = styled.ul`
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
`;

const NavItemLink = styled(NavLink)`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(3)};
  padding: ${(p) => p.theme.space(2)} ${(p) => p.theme.space(3)};
  font-size: 14px;
  font-weight: 600;
  color: ${(p) => p.theme.color.textMuted};
  text-decoration: none;
  border-radius: ${(p) => p.theme.radii.md}px;
  transition:
    background ${(p) => p.theme.motion.fast},
    color ${(p) => p.theme.motion.fast};

  &:hover {
    background: ${(p) => p.theme.color.surfaceAlt};
    color: ${(p) => p.theme.color.text};
  }

  &.active {
    background: ${(p) => p.theme.color.brand}24;
    color: ${(p) => p.theme.color.link};
  }
`;

const Main = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`;

const Burger = styled.button`
  display: none;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  font-size: 15px;
  color: ${(p) => p.theme.color.text};
  background: transparent;
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radii.md}px;
  cursor: pointer;

  &:hover {
    background: ${(p) => p.theme.color.surfaceAlt};
  }

  @media (max-width: ${(p) => p.theme.breakpoints.md}px) {
    display: inline-flex;
  }
`;

const ReadOnlyBanner = styled.div`
  text-align: center;
  padding: 6px 0;
  background: ${(p) => p.theme.color.warning}22;
`;

/** Pause / resume the 30s polling + SSE stream. Icon + label, tooltip below the button. */
function LiveToggle(): React.ReactElement {
  const { live, setLive, refreshNow } = useLive();
  const state = live ? LIVE_TOGGLE_CONFIG.live : LIVE_TOGGLE_CONFIG.paused;
  return (
    <Inline gap={2} align="center">
      <Tooltip title={state.hint} placement="bottom">
        <Button
          size="sm"
          icon={state.icon}
          onClick={() => setLive(!live)}
          aria-label={`${state.label} auto-updates`}
        >
          {state.label}
        </Button>
      </Tooltip>
      {!live && (
        <Tooltip title="Fetch the latest data once" placement="bottom">
          <Button
            size="sm"
            icon={ACTIONS_CONFIG.refresh.icon}
            onClick={refreshNow}
            aria-label="Refresh now"
          />
        </Tooltip>
      )}
    </Inline>
  );
}

export function Shell({ onThemeChange, children }: ShellProps): React.ReactElement {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Navigating closes the mobile drawer.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    <AppShell>
      <Header
        left={
          <Inline gap={3} align="center">
            <Burger
              type="button"
              aria-label="Toggle navigation"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen((open) => !open)}
            >
              <span aria-hidden>☰</span>
            </Burger>
            <Link to="/" aria-label="Home" style={{ display: 'inline-flex' }}>
              <Logo variant="full" size={30} />
            </Link>
          </Inline>
        }
        right={
          <Inline gap={2} align="center">
            <LiveToggle />
            <ThemeSwitcher onChange={onThemeChange} />
          </Inline>
        }
      />

      {config.readOnly ? (
        <ReadOnlyBanner>
          <Text $tone="muted">Read-only mode — mutating actions are disabled.</Text>
        </ReadOnlyBanner>
      ) : null}

      <Body>
        {drawerOpen ? <Scrim onClick={() => setDrawerOpen(false)} /> : null}
        <Nav $open={drawerOpen} aria-label="Main navigation">
          <NavList>
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavItemLink to={item.to} exact={item.exact} activeClassName="active">
                  <span aria-hidden>{item.icon}</span>
                  {item.label}
                </NavItemLink>
              </li>
            ))}
          </NavList>
        </Nav>
        <Main>{children}</Main>
      </Body>
    </AppShell>
  );
}
