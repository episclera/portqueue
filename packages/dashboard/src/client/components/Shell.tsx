/**
 * App chrome: a top bar (logo, live-updates control, theme toggle) over a left sidebar of
 * navigation items and the routed page. Below the `md` breakpoint the sidebar collapses behind
 * a burger button and opens as a focus-trapped overlay drawer.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import {
  AppShell,
  Button,
  Header,
  Inline,
  Logo,
  ThemeSwitcher,
  Tooltip,
  type ThemeMode,
} from '@portqueue/ui';
import { useLive } from './LiveProvider';
import { useRefreshAll } from '../queries/use-queries';
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

/** Sidebar footer links — docs site and repository, side by side. */
const EXTERNAL_LINKS: { href: string; label: string; icon: string }[] = [
  { href: 'https://episclera.github.io/portqueue/', label: 'Docs', icon: '📖' },
  { href: 'https://github.com/episclera/portqueue', label: 'GitHub', icon: '🐙' },
];

const Body = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
`;

/**
 * Off-canvas below `md`. `visibility: hidden` matters as much as the transform: a translated
 * element is still focusable and still reachable by a screen reader, so a "closed" drawer would
 * otherwise keep every nav link in the tab order behind the page. `visibility` transitions
 * discretely (it flips at the end), so the slide-out animation still plays.
 */
const Nav = styled.nav<{ $open: boolean }>`
  flex: 0 0 ${SIDEBAR_WIDTH}px;
  width: ${SIDEBAR_WIDTH}px;
  align-self: flex-start;
  position: sticky;
  top: ${HEADER_HEIGHT}px;
  height: calc(100vh - ${HEADER_HEIGHT}px);
  display: flex;
  flex-direction: column;
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
    visibility: ${(p) => (p.$open ? 'visible' : 'hidden')};
    transition:
      transform ${(p) => p.theme.motion.base},
      visibility ${(p) => p.theme.motion.base};
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

/** Pinned to the bottom of the sidebar: both links share one row. */
const NavFooter = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(2)};
  margin-top: auto;
  padding-top: ${(p) => p.theme.space(3)};
  border-top: 1px solid ${(p) => p.theme.color.border};
`;

const NavFooterLink = styled.a`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${(p) => p.theme.space(2)};
  flex: 1;
  padding: ${(p) => p.theme.space(2)};
  font-size: 13px;
  font-weight: 600;
  color: ${(p) => p.theme.color.textMuted};
  text-decoration: none;
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radii.md}px;
  transition:
    background ${(p) => p.theme.motion.fast},
    color ${(p) => p.theme.motion.fast};

  &:hover {
    background: ${(p) => p.theme.color.surfaceAlt};
    color: ${(p) => p.theme.color.text};
    text-decoration: none;
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

/** Everything that can hold focus inside the drawer. */
const FOCUSABLE = 'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Trap Tab inside the open drawer, close it on Escape, and restore focus to the trigger on close.
 * A modal overlay without this leaves a keyboard user tabbing through the page behind it, which
 * is invisible while the scrim is up.
 */
function useFocusTrap(open: boolean, ref: React.RefObject<HTMLElement>, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the drawer so the next Tab continues from inside it.
    node?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const focusable = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      // Wrap at both ends rather than letting focus escape the overlay.
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, ref, onClose]);
}

/** Pause / resume the interval polling, and refresh on demand. */
function LiveToggle(): React.ReactElement {
  const { live, setLive } = useLive();
  const refresh = useRefreshAll();
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
      {/* Always offered, not only while paused: wanting the freshest data right now is
          independent of whether a 30s interval happens to also be running. */}
      <Tooltip title="Fetch the latest data now" placement="bottom">
        <Button
          size="sm"
          icon={ACTIONS_CONFIG.refresh.icon}
          onClick={refresh}
          aria-label="Refresh now"
        />
      </Tooltip>
    </Inline>
  );
}

export function Shell({ onThemeChange, children }: ShellProps): React.ReactElement {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Navigating closes the mobile drawer.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  useFocusTrap(drawerOpen, navRef, closeDrawer);

  return (
    <AppShell>
      <Header
        left={
          <Inline gap={3} align="center">
            <Burger
              type="button"
              aria-label="Toggle navigation"
              aria-expanded={drawerOpen}
              aria-controls="portqueue-nav"
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

      <Body>
        {drawerOpen ? <Scrim onClick={closeDrawer} /> : null}
        <Nav
          ref={navRef}
          id="portqueue-nav"
          $open={drawerOpen}
          aria-label="Main navigation"
          // Only a dialog while it is an overlay; on desktop it is ordinary page furniture.
          {...(drawerOpen ? { 'aria-modal': true, role: 'dialog' } : {})}
        >
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
          <NavFooter>
            {EXTERNAL_LINKS.map((link) => (
              <NavFooterLink
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
              >
                <span aria-hidden>{link.icon}</span>
                {link.label}
              </NavFooterLink>
            ))}
          </NavFooter>
        </Nav>
        <Main>{children}</Main>
      </Body>
    </AppShell>
  );
}
