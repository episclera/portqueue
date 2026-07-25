/**
 * Client entry. Mounts the SPA: wires the shared `@portqueue/ui` styled-components theme
 * (light/dark following system preference, with a switcher), the toast provider (replacing
 * antd's message API), and the global LiveProvider.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, ToastProvider, useThemeMode } from '@portqueue/ui';
import { App } from './App';
import { LiveProvider } from './components/LiveProvider';
import { config } from './queries/api';

function Root(): React.ReactElement {
  const { effective, setMode } = useThemeMode();
  return (
    <ThemeProvider mode={effective} applyGlobalStyles>
      <ToastProvider>
        <LiveProvider>
          <App onThemeChange={setMode} />
        </LiveProvider>
      </ToastProvider>
    </ThemeProvider>
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
