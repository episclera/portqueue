/**
 * App shell + routing. The chrome (top bar, left sidebar, mobile drawer) lives in `Shell`;
 * each page renders its own full-width subheader band followed by its content. Uses
 * react-router v5; layout + primitives come from `@portqueue/ui` (styled-components).
 */
import React from 'react';
import { HashRouter, Link, Route, Switch as RouteSwitch } from 'react-router-dom';
import { Content, Stack, Text, Title, type ThemeMode } from '@portqueue/ui';
import { Shell } from './components/Shell';
import { OverviewPage } from './pages/Overview';
import { QueueDetailPage } from './pages/QueueDetail';
import { JobDetailPage } from './pages/JobDetail';
import { SchedulesPage } from './pages/Schedules';
import { InstancesPage } from './pages/Instances';

export interface AppProps {
  onThemeChange: (mode: ThemeMode) => void;
}

export function App({ onThemeChange }: AppProps): React.ReactElement {
  return (
    <HashRouter>
      <Shell onThemeChange={onThemeChange}>
        <RouteSwitch>
          <Route exact path="/" component={OverviewPage} />
          <Route exact path="/instances" component={InstancesPage} />
          <Route exact path="/queues/:name" component={QueueDetailPage} />
          <Route exact path="/jobs/:id" component={JobDetailPage} />
          <Route exact path="/schedules" component={SchedulesPage} />
          <Route>
            <Content>
              <Stack gap={2}>
                <Title level={3}>Not found</Title>
                <Text $tone="muted">
                  <Link to="/">Back to overview</Link>
                </Text>
              </Stack>
            </Content>
          </Route>
        </RouteSwitch>
      </Shell>
    </HashRouter>
  );
}
