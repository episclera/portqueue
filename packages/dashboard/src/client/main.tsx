/**
 * Client entry. Mounts the SPA: the shared `@portqueue/ui` styled-components theme (the visitor's
 * own choice, or the OS preference), the toast provider, the TanStack Query cache, and the global
 * LiveProvider.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, ToastProvider, useThemeMode } from '@portqueue/ui';
import { App } from './App';
import { LiveProvider } from './components/LiveProvider';
import { DASHBOARD_TITLE } from '../shared/constants';

/**
 * Cache defaults for every query.
 *
 * **Nothing is served from cache.** `staleTime: 0` and `gcTime: 0` together mean every mount
 * fetches: landing on a page — or coming back to one — always asks the server rather than painting
 * a snapshot from a previous visit. An ops dashboard is read to answer "what is happening right
 * now", and a queue depth or a job status from thirty seconds ago answers that wrongly while
 * looking exactly as authoritative. The cache is still what holds a page's rows while it is open
 * (and what a mutation invalidates); it just never outlives the view that filled it.
 *
 * Failures retry once — enough to ride out a dropped connection, few enough that a genuinely
 * broken endpoint surfaces its error promptly rather than after a backoff chain.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 0,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Root(): React.ReactElement {
  // The visitor owns the theme: the header switcher, persisted in localStorage, over the OS
  // preference until they pick one. The host has no say — see `DashboardConfigDto`.
  const { effective, setMode } = useThemeMode();
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
  document.title = DASHBOARD_TITLE;
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
