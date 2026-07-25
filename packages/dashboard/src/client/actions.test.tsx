/**
 * Behavioural tests for the mutating controls: every row action, popover confirmation and bulk
 * action must reach `POST /api/actions` with the right body — and, since the overlays render
 * through body portals, the confirmation and menu layers must be reachable from `document.body`
 * rather than from inside the (clipped, scrollable) table.
 * @jest-environment jsdom
 */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, ToastProvider } from '@portqueue/ui';
import { App } from './App';
import { LiveProvider } from './components/LiveProvider';

const QUEUES = [
  {
    name: 'emails',
    processingPaused: false,
    acceptingPaused: false,
    inUse: true,
    counts: { PENDING: 1, ACTIVE: 0, COMPLETED: 3, FAILED: 1, RETRY: 0 },
  },
];

const STATS = {
  counts: { ACTIVE: 0, RETRY: 0, FAILED: 1, COMPLETED: 8, STALLED: 0 },
  throughputPerMinute: 1.5,
  failureRate: 0.1,
};

/** PENDING so both Cancel and Retry are enabled on the row. */
const JOB = {
  id: 'job-abcdef123456',
  queue: 'emails',
  status: 'PENDING',
  data: {},
  priority: 0,
  retryAttempt: 0,
  retryMaxAttempts: 3,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  startAfter: '2026-07-22T00:00:00.000Z',
  processedOnInstanceKey: null,
  preferredInstanceKeyPattern: null,
  stalled: false,
};

interface Posted {
  url: string;
  body: unknown;
}

let posted: Posted[] = [];

function stubFetch(): void {
  global.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    const body = url.includes('/api/queues')
      ? QUEUES
      : url.includes('/api/stats')
        ? STATS
        : url.includes('/api/jobs')
          ? { items: [JOB], cursor: null, hasMore: false, total: 1 }
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

/** The row-action icon button (its label lives in `aria-label`, not in the glyph). */
function rowAction(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

const lastAction = (): unknown => posted.at(-1)?.body;

beforeEach(() => {
  posted = [];
  stubFetch();
  window.localStorage.clear();
});

describe('job row actions', () => {
  it('retries a job straight away (no confirmation)', async () => {
    renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Retry'));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.url).toContain('/api/actions');
    expect(lastAction()).toEqual({ kind: 'retry', queue: 'emails', jobId: JOB.id });
  });

  it('cancels a job through its confirmation popover, which renders in a body portal', async () => {
    renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Cancel'));

    const popover = await screen.findByRole('dialog');
    expect(popover).toHaveTextContent('Cancel this job?');
    // Portalled: a direct child of <body>, not of the scrollable table wrapper.
    expect(popover.parentElement).toBe(document.body);

    fireEvent.click(within(popover).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(lastAction()).toEqual({ kind: 'cancel', queue: 'emails', jobId: JOB.id });
  });

  it('dismisses the confirmation popover without acting when the user backs out', async () => {
    renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Remove'));
    const popover = await screen.findByRole('dialog');
    fireEvent.click(within(popover).getByRole('button', { name: 'Keep' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(posted).toHaveLength(0);
  });

  it('removes a job through its confirmation popover', async () => {
    renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Remove'));
    const popover = await screen.findByRole('dialog');
    expect(popover).toHaveTextContent('Remove this job permanently?');

    fireEvent.click(within(popover).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(lastAction()).toEqual({ kind: 'remove', queue: 'emails', jobId: JOB.id });
  });

  it('closes the popover on Escape and on an outside click', async () => {
    renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Remove'));
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(rowAction('Remove'));
    await screen.findByRole('dialog');
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(posted).toHaveLength(0);
  });
});

describe('bulk job actions', () => {
  it('runs a bulk retry from the portalled dropdown menu', async () => {
    renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(screen.getByLabelText(`Select row ${JOB.id}`));
    fireEvent.click(await screen.findByRole('button', { name: /Bulk actions \(1\)/ }));

    const menu = await screen.findByRole('menu');
    expect(menu.parentElement).toBe(document.body);

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Retry selected/ }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(lastAction()).toEqual({ kind: 'retry', queue: 'emails', jobId: JOB.id });
  });

  it('asks for confirmation in a modal before a bulk remove', async () => {
    renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(screen.getByLabelText(`Select row ${JOB.id}`));
    fireEvent.click(await screen.findByRole('button', { name: /Bulk actions \(1\)/ }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Remove selected/ }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Remove 1 job(s)?');
    expect(posted).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(lastAction()).toEqual({ kind: 'remove', queue: 'emails', jobIds: [JOB.id] });
  });
});

describe('queue row actions', () => {
  it('pauses a queue from the overview table, after its confirmation popover', async () => {
    renderApp('#/');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Pause'));
    const popover = await screen.findByRole('dialog');
    expect(popover).toHaveTextContent('Pause processing on this queue?');

    fireEvent.click(within(popover).getByRole('button', { name: 'Pause' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(lastAction()).toMatchObject({ kind: 'pause', queue: 'emails' });
  });
});
