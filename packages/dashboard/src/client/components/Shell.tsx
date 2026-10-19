/**
 * App chrome: a top bar (logo, live-updates control, theme toggle) over a left sidebar of
 * navigation items and the routed page. Below the `md` breakpoint the sidebar collapses behind
 * a burger button and opens as a focus-trapped overlay drawer.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import {
  AppShell,
  Button,
  DocsIcon,
  GithubIcon,
  Header,
  Inline,
  InstancesIcon,
  Logo,
  MenuIcon,
  OverviewIcon,
  SchedulesIcon,
  ThemeSwitcher,
  Tooltip,
  type ThemeMode,
} from '@portqueue/ui';
import { useLive } from './LiveProvider';
import { useRefreshAll } from '../queries/use-queries';
import { ACTIONS_CONFIG, LIVE_TOGGLE_CONFIG } from '../constants/labels';
import styles from './Shell.module.css';

export interface ShellProps {
  onThemeChange: (mode: ThemeMode) => void;
  children: React.ReactNode;
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: <OverviewIcon />, exact: true },
  { to: '/instances', label: 'Instances', icon: <InstancesIcon /> },
  { to: '/schedules', label: 'Schedules', icon: <SchedulesIcon /> },
];

/** Sidebar footer links — docs site and repository, side by side. */
const EXTERNAL_LINKS: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: 'https://episclera.github.io/portqueue/', label: 'Docs', icon: <DocsIcon /> },
  { href: 'https://github.com/episclera/portqueue', label: 'GitHub', icon: <GithubIcon /> },
];

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
          independent of whether the poll interval happens to also be running. */}
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
            <button
              className={styles.burger}
              type="button"
              aria-label="Toggle navigation"
              aria-expanded={drawerOpen}
              aria-controls="portqueue-nav"
              onClick={() => setDrawerOpen((open) => !open)}
            >
              <MenuIcon aria-hidden />
            </button>
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

      <div className={styles.body}>
        {drawerOpen ? <div className={styles.scrim} onClick={closeDrawer} /> : null}
        <nav
          ref={navRef}
          id="portqueue-nav"
          className={clsx(styles.nav, drawerOpen && styles.navOpen)}
          aria-label="Main navigation"
          // Only a dialog while it is an overlay; on desktop it is ordinary page furniture.
          {...(drawerOpen ? { 'aria-modal': true, role: 'dialog' } : {})}
        >
          <ul className={styles.navList}>
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  className={styles.navItemLink}
                  to={item.to}
                  exact={item.exact}
                  activeClassName={styles.active}
                >
                  <span aria-hidden>{item.icon}</span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className={styles.navFooter}>
            {EXTERNAL_LINKS.map((link) => (
              <a
                className={styles.navFooterLink}
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
              >
                <span aria-hidden>{link.icon}</span>
                {link.label}
              </a>
            ))}
          </div>
        </nav>
        <div className={styles.main}>{children}</div>
      </div>
    </AppShell>
  );
}
