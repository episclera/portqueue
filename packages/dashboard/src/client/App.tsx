/**
 * App shell + routing. Header carries the Logo, global search, the live-updates toggle,
 * and the ThemeSwitcher. Uses react-router v5. Layout + primitives come from `@portqueue/ui`
 * (styled-components); theming is provided by the ThemeProvider wired in main.tsx.
 */
import React, { useState } from 'react';
import { HashRouter, Link, Route, Switch as RouteSwitch, useHistory } from 'react-router-dom';
import styled from 'styled-components';
import {
  AppShell,
  Button,
  Content,
  Header,
  Inline,
  Input,
  Logo,
  Switch,
  Text,
  ThemeSwitcher,
  Title,
  Tooltip,
  type ThemeMode,
} from '@portqueue/ui';
import { config } from './queries/api.js';
import { useLive } from './components/LiveProvider.js';
import { OverviewPage } from './pages/Overview.js';
import { QueueDetailPage } from './pages/QueueDetail.js';
import { JobDetailPage } from './pages/JobDetail.js';
import { SchedulesPage } from './pages/Schedules.js';
import { InstancesPage } from './pages/Instances.js';

export interface AppProps {
  themeMode: ThemeMode;
  onThemeChange: (m: ThemeMode) => void;
}

const NavLink = styled(Link)`
  color: ${(p) => p.theme.color.textMuted};
  font-weight: 600;
  text-decoration: none;
  &:hover {
    color: ${(p) => p.theme.color.text};
  }
`;

const ReadOnlyBanner = styled.div`
  text-align: center;
  padding: 6px 0;
  background: ${(p) => p.theme.color.warning}22;
`;

function GlobalSearch(): React.ReactElement {
  const history = useHistory();
  const [value, setValue] = useState('');
  const go = (id: string): void => {
    if (id.trim()) history.push(`/jobs/${encodeURIComponent(id.trim())}`);
  };
  return (
    <Input
      value={value}
      placeholder="Jump to job id…"
      inputSize="sm"
      style={{ width: 'clamp(140px, 24vw, 320px)' }}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') go(value);
      }}
      aria-label="Search job by id"
    />
  );
}

function LiveToggle(): React.ReactElement {
  const { live, setLive, refreshNow } = useLive();
  return (
    <Inline gap={2} align="center">
      <Tooltip title={live ? 'Auto-updates on (30s)' : 'Auto-updates paused — data is frozen'}>
        <Inline gap={1} align="center">
          <span aria-hidden>{live ? '▶️' : '⏸️'}</span>
          <Switch size="sm" checked={live} onChange={setLive} aria-label="Toggle live updates" />
        </Inline>
      </Tooltip>
      {!live && (
        <Button size="sm" onClick={refreshNow}>
          Refresh now
        </Button>
      )}
    </Inline>
  );
}

export function App({ themeMode, onThemeChange }: AppProps): React.ReactElement {
  return (
    <HashRouter>
      <AppShell>
        <Header
          left={
            <Inline gap={4} align="center">
              <Link to="/" aria-label="Home" style={{ display: 'inline-flex' }}>
                <Logo variant="full" size={30} />
              </Link>
              <Inline gap={3} align="center">
                <NavLink to="/">Overview</NavLink>
                <NavLink to="/instances">Instances</NavLink>
                <NavLink to="/schedules">Schedules</NavLink>
              </Inline>
            </Inline>
          }
          right={
            <Inline gap={3} align="center" wrap>
              <span aria-hidden style={{ opacity: 0.6 }}>
                🔍
              </span>
              <GlobalSearch />
              <LiveToggle />
              <ThemeSwitcher value={themeMode} onChange={onThemeChange} />
            </Inline>
          }
        />

        {config.readOnly ? (
          <ReadOnlyBanner>
            <Text $tone="muted">Read-only mode — mutating actions are disabled.</Text>
          </ReadOnlyBanner>
        ) : null}

        <Content>
          <RouteSwitch>
            <Route exact path="/" component={OverviewPage} />
            <Route exact path="/instances" component={InstancesPage} />
            <Route exact path="/queues/:name" component={QueueDetailPage} />
            <Route exact path="/jobs/:id" component={JobDetailPage} />
            <Route exact path="/schedules" component={SchedulesPage} />
            <Route>
              <Title level={3}>Not found</Title>
              <Link to="/">Back to overview</Link>
            </Route>
          </RouteSwitch>
        </Content>
      </AppShell>
    </HashRouter>
  );
}
