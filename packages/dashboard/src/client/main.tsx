/**
 * Client entry. Mounts the SPA: wires the shared `@portqueue/ui` light/dark
 * themes into AntD's ConfigProvider (following system preference with a switcher), the AntD
 * `App` wrapper (message/modal context), and the global LiveProvider.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider, theme as antdTheme } from 'antd';
import { darkTheme, lightTheme, useThemeMode } from '@portqueue/ui';
import { App } from './App.js';
import { LiveProvider } from './components/LiveProvider.js';
import { config } from './queries/api.js';

function Root(): React.ReactElement {
  const { mode, effective, setMode } = useThemeMode();
  const base = effective === 'dark' ? darkTheme : lightTheme;
  return (
    <ConfigProvider
      theme={{
        ...base,
        algorithm: effective === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      }}
    >
      <AntApp>
        <LiveProvider>
          <App themeMode={mode} onThemeChange={setMode} />
        </LiveProvider>
      </AntApp>
    </ConfigProvider>
  );
}

const container = document.getElementById('root');
if (container) {
  document.title = config.title;
  createRoot(container).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
}
