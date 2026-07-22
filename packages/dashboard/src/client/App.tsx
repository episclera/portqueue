/**
 * App shell + routing (build_plan/12.4). Header carries the Logo, global search, the
 * live-updates toggle, and the ThemeSwitcher. Uses react-router v5. AntD theming is driven by
 * the shared `@portqueue/ui` themes through ConfigProvider (wired in main.tsx).
 */
import React, { useState } from 'react';
import { HashRouter, Link, Route, Switch, useHistory } from 'react-router-dom';
import {
  AutoComplete,
  Button,
  Layout,
  Space,
  Switch as AntSwitch,
  Tooltip,
  Typography,
} from 'antd';
import { PauseCircleOutlined, PlayCircleOutlined, SearchOutlined } from '@ant-design/icons';
import { Logo, ThemeSwitcher, type ThemeMode } from '@portqueue/ui';
import { config } from './queries/api.js';
import { useLive } from './components/LiveProvider.js';
import { useStyles } from './components/styles.js';
import { OverviewPage } from './pages/Overview.js';
import { QueueDetailPage } from './pages/QueueDetail.js';
import { JobDetailPage } from './pages/JobDetail.js';
import { SchedulesPage } from './pages/Schedules.js';

export interface AppProps {
  themeMode: ThemeMode;
  onThemeChange: (m: ThemeMode) => void;
}

function GlobalSearch(): React.ReactElement {
  const history = useHistory();
  const [value, setValue] = useState('');
  const go = (id: string): void => {
    if (id.trim()) history.push(`/jobs/${encodeURIComponent(id.trim())}`);
  };
  return (
    <AutoComplete
      value={value}
      onChange={setValue}
      style={{ width: 'clamp(140px, 24vw, 320px)' }}
      onSelect={go}
    >
      <Space.Compact style={{ width: '100%' }}>
        <input
          placeholder="Jump to job id…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(value);
          }}
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            padding: '6px 10px',
            borderRadius: 8,
          }}
          aria-label="Search job by id"
        />
      </Space.Compact>
    </AutoComplete>
  );
}

function LiveToggle(): React.ReactElement {
  const { live, setLive, refreshNow } = useLive();
  return (
    <Space size="small">
      <Tooltip title={live ? 'Auto-updates on (30s)' : 'Auto-updates paused — data is frozen'}>
        <Space size={4}>
          {live ? <PlayCircleOutlined /> : <PauseCircleOutlined style={{ color: '#f59e0b' }} />}
          <AntSwitch
            size="small"
            checked={live}
            onChange={setLive}
            aria-label="Toggle live updates"
          />
        </Space>
      </Tooltip>
      {!live && (
        <Button size="small" onClick={refreshNow}>
          Refresh now
        </Button>
      )}
    </Space>
  );
}

export function App({ themeMode, onThemeChange }: AppProps): React.ReactElement {
  const { styles } = useStyles();
  return (
    <HashRouter>
      <Layout className={styles.appShell}>
        <header className={styles.header}>
          <Link to="/" aria-label="Home" style={{ display: 'inline-flex' }}>
            <Logo variant="full" size={30} />
          </Link>
          <div className={styles.headerSpacer} />
          <Space size="middle" wrap>
            <SearchOutlined style={{ opacity: 0.6 }} />
            <GlobalSearch />
            <LiveToggle />
            <ThemeSwitcher value={themeMode} onChange={onThemeChange} />
          </Space>
        </header>

        {!config.readOnly ? null : (
          <div style={{ textAlign: 'center', padding: '6px 0', background: '#94a3b822' }}>
            <Typography.Text type="secondary">
              Read-only mode — mutating actions are disabled.
            </Typography.Text>
          </div>
        )}

        <Layout.Content>
          <div className={styles.content}>
            <Switch>
              <Route exact path="/" component={OverviewPage} />
              <Route exact path="/queues/:name" component={QueueDetailPage} />
              <Route exact path="/jobs/:id" component={JobDetailPage} />
              <Route exact path="/schedules" component={SchedulesPage} />
              <Route>
                <Typography.Title level={3}>Not found</Typography.Title>
                <Link to="/">Back to overview</Link>
              </Route>
            </Switch>
          </div>
        </Layout.Content>
      </Layout>
    </HashRouter>
  );
}
