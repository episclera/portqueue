/**
 * Client entry. Mounts the SPA: the shared `@portqueue/ui` styled-components theme (seeded from
 * the host's configured default, then the visitor's own choice), the toast provider, the
 * TanStack Query cache, and the global LiveProvider.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, ToastProvider, useThemeMode } from '@portqueue/ui';
import { App } from './App';
import { LiveProvider } from './components/LiveProvider';
import { config } from './queries/api';
import { REFETCH_INTERVAL_MS } from './queries/use-queries';

/**
 * Cache defaults for every query.
 *
 * `staleTime` is half the poll interval: navigating back to a page inside that window reuses what
 * is already cached instead of refetching, while anything older refreshes on mount. Failures retry
 * once — enough to ride out a dropped connection, few enough that a genuinely broken endpoint
 * surfaces its error promptly rather than after a backoff chain.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: REFETCH_INTERVAL_MS / 2,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Root(): React.ReactElement {
  // The host's `theme` option is the default for a visitor who has not picked one; the header
  // switcher (persisted in localStorage) always wins over it.
  const { effective, setMode } = useThemeMode(config.theme);
  return (
    <ThemeProvider mode={effective} applyGlobalStyles>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <LiveProvider>
            <App onThemeChange={setMode} />
          </LiveProvider>
        </QueryClientProvider>
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
} else {
  // Silently doing nothing makes a broken shell indistinguishable from a blank page.
  console.error(
    '[portqueue-dashboard] No #root element found; the SPA did not mount. The served HTML shell ' +
      'is missing its mount point — the client bundle may be stale or partially built.',
  );
}
