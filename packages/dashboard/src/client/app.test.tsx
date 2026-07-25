/**
 * Render smoke tests for the SPA shell and the two table-heavy pages. They assert the chrome
 * (sidebar nav, theme toggle, live control) and the table-card contract every table shares:
 * a "Results (n)" count, a Filters button, a search box and always-present pagination.
 * @jest-environment jsdom
 */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, ToastProvider } from '@portqueue/ui';
import { App } from './App';
import { LiveProvider } from './components/LiveProvider';

const QUEUES = [
  {
    name: 'emails',
    processingPaused: false,
    acceptingPaused: false,
    inUse: true,
    counts: { PENDING: 1, ACTIVE: 2, COMPLETED: 3, FAILED: 0, RETRY: 0 },
  },
  {
    name: 'reports',
    processingPaused: true,
    acceptingPaused: false,
    inUse: false,
    counts: { PENDING: 0, ACTIVE: 0, COMPLETED: 5, FAILED: 1, RETRY: 0 },
  },
];

const JOB = {
  id: 'job-abcdef123456',
  queue: 'emails',
  status: 'FAILED',
  data: {},
  priority: 0,
  retryAttempt: 1,
  retryMaxAttempts: 3,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  startAfter: '2026-07-22T00:00:00.000Z',
  processedOnInstanceKey: 'worker-eu-1',
  preferredInstanceKeyPattern: 'worker-eu-*',
  stalled: false,
};

const STATS = {
  counts: { ACTIVE: 2, RETRY: 0, FAILED: 1, COMPLETED: 8, STALLED: 0 },
  throughputPerMinute: 1.5,
  failureRate: 0.1,
};

/** Route every dashboard GET to a canned payload. */
function stubFetch(): void {
  global.fetch = (async (input: unknown) => {
    const url = String(input);
    const body = url.includes('/api/queues')
      ? QUEUES
      : url.includes('/api/stats')
        ? STATS
        : url.includes('/api/jobs')
          ? { items: [JOB], cursor: null, hasMore: false, total: 42 }
          : url.includes('/api/schedules')
            ? []
            : url.includes('/api/instances')
              ? []
              : {};
    return { ok: true, status: 200, json: async () => body };
  }) as never;
}

function renderApp(hash: string): void {
  window.location.hash = hash;
  render(
    <ThemeProvider mode="light">
      <ToastProvider>
        <LiveProvider>
          <App onThemeChange={() => {}} />
        </LiveProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  stubFetch();
  window.localStorage.clear();
});

describe('app shell', () => {
  it('renders the sidebar navigation, the live control and the theme toggle', async () => {
    renderApp('#/');

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: /Overview/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Instances/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Schedules/ })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Pause auto-updates/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Switch to dark theme/ })).toBeInTheDocument();
    // The burger exists but CSS hides it above the md breakpoint (jsdom is 1024px wide).
    expect(screen.getByLabelText('Toggle navigation')).toBeInTheDocument();
  });
});

describe('overview page', () => {
  it('shows the activity cards and the queues table with a result count and pagination', async () => {
    renderApp('#/');

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    // Activity cards only — no throughput / failure-rate cards.
    expect((await screen.findAllByText('Completed')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Jobs / min')).not.toBeInTheDocument();
    expect(screen.queryByText('Failure rate')).not.toBeInTheDocument();

    expect(await screen.findByText('Results (2)')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'emails' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Filters/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Search queue name')).toBeInTheDocument();
    // A single page still renders its pagination, with both steps disabled.
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('opens the filters dialog with the state and usage pickers', async () => {
    renderApp('#/');

    fireEvent.click(await screen.findByRole('button', { name: /Filters/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('State')).toBeInTheDocument();
    expect(within(dialog).getByText('Usage')).toBeInTheDocument();
  });
});

describe('queue detail page', () => {
  it('renders the jobs table with the instance columns, actions and a server-side total', async () => {
    renderApp('#/queues/emails');

    expect(await screen.findByRole('heading', { name: 'emails' })).toBeInTheDocument();
    expect(await screen.findByText('Results (42)')).toBeInTheDocument();

    expect(await screen.findByText('Processed On Instance')).toBeInTheDocument();
    expect(screen.getByText('Preferred Instance Pattern')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();

    // Statuses render through the label config, never as a raw enum value.
    expect(screen.queryByText('FAILED')).not.toBeInTheDocument();
    expect((await screen.findAllByText('Failed')).length).toBeGreaterThan(0);

    // 42 rows at 20 a page → three pages of numbered pagination.
    expect(screen.getByRole('button', { name: 'Page 3' })).toBeInTheDocument();
  });

  it('reveals bulk actions only once a row is selected', async () => {
    renderApp('#/queues/emails');

    await screen.findByText('Results (42)');
    expect(screen.queryByRole('button', { name: /Bulk actions/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(`Select row ${JOB.id}`));
    expect(await screen.findByRole('button', { name: /Bulk actions \(1\)/ })).toBeInTheDocument();
  });
});
