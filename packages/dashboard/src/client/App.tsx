/**
 * App shell + routing. The chrome (top bar, left sidebar, mobile drawer) lives in `Shell`;
 * each page renders its own full-width subheader band followed by its content. Uses
 * react-router v5; every component is antd, themed from `@portqueue/theme` in `theme.ts`.
 */
import React from 'react';
import { HashRouter, Route, Switch as RouteSwitch, useLocation } from 'react-router-dom';
import { Typography } from 'antd';
import { Shell } from './components/Shell';
import { PageBody } from './components/layout';
import type { ThemeMode, ThemePreference } from './theme';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OverviewPage } from './pages/Overview';
import { QueueDetailPage } from './pages/QueueDetail';
import { JobDetailPage } from './pages/JobDetail';
import { SchedulesPage } from './pages/Schedules';
import { ScheduleDetailPage } from './pages/ScheduleDetail';
import { InstancesPage } from './pages/Instances';
import { InstanceDetailPage } from './pages/InstanceDetail';
import { AppLink } from './components/AppLink';

export interface AppProps {
  /** The theme in effect — what the header toggle shows. */
  mode: ThemeMode;
  onThemeChange: (mode: ThemePreference) => void;
}

/**
 * The routed pages, wrapped in an error boundary keyed on the path — navigating away from a page
 * that threw resets the boundary, so one bad record can't strand the whole dashboard.
 */
function Routes(): React.ReactElement {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <RouteSwitch>
        <Route exact path="/" component={OverviewPage} />
        <Route exact path="/instances" component={InstancesPage} />
        <Route exact path="/instances/:key" component={InstanceDetailPage} />
        <Route exact path="/queues/:name" component={QueueDetailPage} />
        <Route exact path="/jobs/:id" component={JobDetailPage} />
        <Route exact path="/schedules" component={SchedulesPage} />
        <Route exact path="/schedules/:id" component={ScheduleDetailPage} />
        <Route>
          <PageBody>
            <Typography.Title level={3}>Not found</Typography.Title>
            <AppLink to="/">Back to overview</AppLink>
          </PageBody>
        </Route>
      </RouteSwitch>
    </ErrorBoundary>
  );
}

export function App({ mode, onThemeChange }: AppProps): React.ReactElement {
  return (
    <HashRouter>
      <Shell mode={mode} onThemeChange={onThemeChange}>
        <Routes />
      </Shell>
    </HashRouter>
  );
}
