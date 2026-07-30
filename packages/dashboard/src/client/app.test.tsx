/**
 * Render tests for the SPA shell and the table-heavy pages. They assert the chrome (sidebar nav,
 * theme toggle, live control) and the table-card contract every table shares: a "Results (n)"
 * count, a Filters button, a search box and always-present pagination.
 *
 * They also cover the two states a data view has besides "showing rows" — a failed query must
 * show an error with a retry, not an empty table, and an empty one must teach rather than dead-end.
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createHarness, page, type StubOptions } from '../test-support/render';
import { DATE_COLUMN_MIN_WIDTH } from './components/table-columns';
import { formatDateTimeParts } from './components/format';

const QUEUES = page(
  [
    {
      name: 'emails',
      processingPaused: false,
      acceptingPaused: false,
      counts: { PENDING: 1, ACTIVE: 2, COMPLETED: 3, FAILED: 0, RETRY: 0 },
    },
    {
      name: 'reports',
      processingPaused: true,
      acceptingPaused: false,
      counts: { PENDING: 0, ACTIVE: 0, COMPLETED: 5, FAILED: 1, RETRY: 0 },
    },
  ],
  2,
);

const JOB = {
  id: 'job-abcdef123456',
  queue: 'emails',
  status: 'FAILED',
  data: { to: 'ada@example.com' },
  returnValue: 'delivery deferred',
  priority: 0,
  retryAttempt: 1,
  retryMaxAttempts: 3,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  startAfter: '2026-07-22T00:00:00.000Z',
  failedAt: '2026-07-22T00:01:00.000Z',
  processedOnInstanceKey: 'worker-eu-1',
  preferredInstanceKeyPattern: 'worker-eu-*',
  failureMessage: 'smtp timeout',
  scheduleId: 'sch-nightly',
  stalled: false,
};

const SCHEDULE = {
  scheduleId: 'sch-nightly',
  queue: 'emails',
  cron: '0 0 * * *',
  everySeconds: null,
  timezone: 'UTC',
  nextRunAt: '2026-07-23T00:00:00.000Z',
  lastRunAt: '2026-07-22T00:00:00.000Z',
  enabled: true,
};

const STATS = { counts: { ACTIVE: 2, RETRY: 0, FAILED: 1, COMPLETED: 8, STALLED: 0 } };

const RESPONSES: Record<string, unknown> = {
  '/queues': QUEUES,
  '/stats': STATS,
  '/jobs': { items: [JOB], total: 42 },
  [`/jobs/${JOB.id}`]: JOB,
  '/schedules': page([SCHEDULE]),
  [`/schedules/${SCHEDULE.scheduleId}`]: SCHEDULE,
  '/instances': page([]),
};

const harness = (over: StubOptions = {}) => createHarness({ responses: RESPONSES, ...over });

beforeEach(() => window.localStorage.clear());

describe('app shell', () => {
  it('renders the sidebar navigation, the live control and the theme toggle', () => {
    harness().renderApp('#/');

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: /Overview/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Instances/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Schedules/ })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Pause auto-updates/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Switch to dark theme/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Toggle navigation')).toBeInTheDocument();
  });

  it('offers Refresh now even while live updates are running', () => {
    // It used to appear only when polling was paused, which conflated "I want it now" with
    // "I don't want it automatically".
    harness().renderApp('#/');
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeInTheDocument();
  });

  it('never renders a read-only banner — the mode no longer exists', () => {
    harness().renderApp('#/');
    expect(screen.queryByText(/Read-only mode/)).not.toBeInTheDocument();
  });

  it('draws its icons as SVGs, never as emoji', () => {
    // The chrome used to use emoji glyphs, which rendered as a different picture per platform
    // and couldn't take the theme colour. Every icon is now an inline SVG inheriting
    // currentColor, so a stray emoji anywhere in the shell is a regression.
    harness().renderApp('#/');

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    // One per nav item (Overview / Instances / Schedules) plus the two footer links.
    expect(nav.querySelectorAll('svg[data-icon]').length).toBeGreaterThanOrEqual(5);
    // Icon-only controls keep their name in aria-label, not in a glyph.
    expect(
      screen.getByLabelText('Toggle navigation').querySelector('svg[data-icon]'),
    ).not.toBeNull();

    expect(document.body.textContent ?? '').not.toMatch(
      /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|\u{FE0F}/u,
    );
  });
});

describe('overview page', () => {
  it('shows the activity cards and the queues table with a result count and pagination', async () => {
    harness().renderApp('#/');

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    // Activity cards only — throughput and failure rate are gone from the whole stack.
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

  it('pages the queues table on the server rather than fetching every row', async () => {
    const h = harness();
    h.renderApp('#/');
    await screen.findByText('Results (2)');
    const queueRequest = h.requests.find((r) => r.url === '/queues');
    expect(queueRequest?.params).toMatchObject({ limit: 20, offset: 0 });
  });

  it('opens the filters dialog with the state picker', async () => {
    harness().renderApp('#/');

    fireEvent.click(await screen.findByRole('button', { name: /Filters/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('State')).toBeInTheDocument();
    // There is no "Usage" filter: `inUse` is process-local, and the dashboard runs on its own
    // client rather than the application's, so it cannot know what the workers declare.
    expect(within(dialog).queryByText('Usage')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the queues query fails, not an empty table', async () => {
    harness({
      failures: { '/queues': { status: 500, body: { error: 'database is unavailable' } } },
    }).renderApp('#/');

    expect(await screen.findByText('Could not load queues')).toBeInTheDocument();
    // The server's own message, not axios' "Request failed with status code 500".
    expect(screen.getByText('database is unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // Crucially not the empty state, which would read as "you have no queues".
    expect(screen.queryByText('No queues yet.')).not.toBeInTheDocument();
  });

  it('replaces the activity cards with an error when the stats query fails', async () => {
    // Rendering zeros here would read as "the queue is idle", the opposite of "we don't know".
    harness({ failures: { '/stats': { status: 503 } } }).renderApp('#/');
    expect(await screen.findByText('Could not load activity')).toBeInTheDocument();
  });

  it('teaches on the empty state instead of dead-ending', async () => {
    harness({ responses: { ...RESPONSES, '/queues': page([]) } }).renderApp('#/');

    expect(await screen.findByText('No queues yet.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Getting started/ });
    expect(link.getAttribute('href')).toContain('/getting-started/first-queue');
  });
});

describe('queue detail page', () => {
  it('renders the jobs table with the instance columns, actions and a server-side total', async () => {
    harness().renderApp('#/queues/emails');

    expect(await screen.findByRole('heading', { name: 'emails' })).toBeInTheDocument();
    expect(await screen.findByText('Results (42)')).toBeInTheDocument();

    expect(await screen.findByText('Processed On Instance')).toBeInTheDocument();
    // The preferred-instance pattern is detail-page material, not a jobs-table column.
    expect(screen.queryByText('Preferred Instance Pattern')).not.toBeInTheDocument();
    expect(screen.getByText('Start After')).toBeInTheDocument();
    expect(screen.getByText('Created At')).toBeInTheDocument();
    expect(screen.getByText('Completed At')).toBeInTheDocument();
    expect(screen.getByText('Failed At')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();

    // Statuses render through the label config, never as a raw enum value.
    expect(screen.queryByText('FAILED')).not.toBeInTheDocument();
    expect((await screen.findAllByText('Failed')).length).toBeGreaterThan(0);

    // 42 rows at 20 a page → three pages of numbered pagination.
    expect(screen.getByRole('button', { name: 'Page 3' })).toBeInTheDocument();
  });

  it('gives every timestamp column the same width floor, so a date never wraps', async () => {
    harness().renderApp('#/queues/emails');

    await screen.findByText('Results (42)');
    for (const title of ['Created At', 'Start After', 'Completed At', 'Failed At']) {
      const header = screen.getByText(title).closest('th');
      // Asserted against the constant, not a literal: what matters is that every date column
      // shares one floor, not what this month's number happens to be.
      expect(header).toHaveStyle({ minWidth: `${DATE_COLUMN_MIN_WIDTH}px` });
    }
  });

  it('stacks the timezone under the instant in every date cell', async () => {
    harness().renderApp('#/queues/emails');

    await screen.findByText('Results (42)');
    const { instant, offset } = formatDateTimeParts(Date.parse(JOB.createdAt))!;

    // The narrow date columns rely on this: the instant on one line, the offset below it. A cell
    // rendering the one-line form would overflow 170px and wrap mid-timestamp.
    const cell = screen.getAllByTitle(JOB.createdAt)[0]!;
    expect(cell).toHaveTextContent(`${instant}${offset}`);
    expect(within(cell).getByText(offset)).toBeInTheDocument();
  });

  it('reveals bulk actions only once a row is selected', async () => {
    harness().renderApp('#/queues/emails');

    await screen.findByText('Results (42)');
    expect(screen.queryByRole('button', { name: /Bulk actions/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(`Select row ${JOB.id}`));
    expect(await screen.findByRole('button', { name: /Bulk actions \(1\)/ })).toBeInTheDocument();
  });

  it('links the instance that claimed a row to that instance’s page', async () => {
    harness().renderApp('#/queues/emails');

    await screen.findByText('Results (42)');
    const link = screen.getByRole('link', { name: JOB.processedOnInstanceKey });
    expect(link).toHaveAttribute('href', `#/instances/${JOB.processedOnInstanceKey}`);
  });

  it('shows an error state when the jobs query fails', async () => {
    harness({
      failures: { '/jobs': { status: 500, body: { error: 'query timed out' } } },
    }).renderApp('#/queues/emails');
    expect(await screen.findByText('Could not load jobs')).toBeInTheDocument();
    expect(screen.getByText('query timed out')).toBeInTheDocument();
  });
});

describe('job detail page', () => {
  it('shows the whole record, both payloads and every lifecycle timestamp', async () => {
    harness().renderApp(`#/jobs/${JOB.id}`);

    expect(await screen.findByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Preferred instance pattern')).toBeInTheDocument();
    expect(screen.getByText(JOB.preferredInstanceKeyPattern)).toBeInTheDocument();
    expect(screen.getByText(JOB.processedOnInstanceKey)).toBeInTheDocument();
    expect(screen.getByText('Locked until')).toBeInTheDocument();
    expect(screen.getByText(JOB.failureMessage)).toBeInTheDocument();

    // Data is pretty-printed JSON; a scalar return value stays a plain string.
    expect(screen.getByText(/"to": "ada@example.com"/)).toBeInTheDocument();
    expect(screen.getByText('Return value')).toBeInTheDocument();
    expect(screen.getByText(JOB.returnValue)).toBeInTheDocument();

    expect(screen.getByText('Timestamps')).toBeInTheDocument();
    for (const label of [
      'Created at',
      'Start after',
      'Started at',
      'Retried at',
      'Stalled at',
      'Completed at',
      'Failed at',
      'Cancelled at',
      'Expired at',
      'Updated at',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('never prints a raw enum, including on the lifecycle timeline', async () => {
    // The timeline head used to render `job.status` directly — "Now: FAILED".
    harness().renderApp(`#/jobs/${JOB.id}`);
    await screen.findByText('Details');
    expect(screen.getByText(/^Now:/)).toHaveTextContent('Now: Failed');
    expect(screen.queryByText(/Now: FAILED/)).not.toBeInTheDocument();
  });

  it('links a job’s schedule to that schedule’s own page', async () => {
    // It used to link to the bare /schedules list, which answered nothing about this job.
    harness().renderApp(`#/jobs/${JOB.id}`);
    await screen.findByText('Details');
    const link = screen.getByRole('link', { name: JOB.scheduleId });
    expect(link).toHaveAttribute('href', `#/schedules/${JOB.scheduleId}`);
  });

  it('links the instance that processed the job to that instance’s page', async () => {
    harness().renderApp(`#/jobs/${JOB.id}`);
    await screen.findByText('Details');
    const link = screen.getByRole('link', { name: JOB.processedOnInstanceKey });
    expect(link).toHaveAttribute('href', `#/instances/${JOB.processedOnInstanceKey}`);
  });

  it('shows an error with a retry when the job cannot be loaded', async () => {
    harness({
      failures: { [`/jobs/${JOB.id}`]: { status: 404, body: { error: 'Job not found' } } },
    }).renderApp(`#/jobs/${JOB.id}`);

    expect(await screen.findByText('Could not load this job')).toBeInTheDocument();
    expect(screen.getByText('Job not found')).toBeInTheDocument();
  });
});

describe('schedule detail page', () => {
  it('shows the definition and the jobs that schedule produced', async () => {
    const h = harness();
    h.renderApp(`#/schedules/${SCHEDULE.scheduleId}`);

    expect(await screen.findByText('Definition')).toBeInTheDocument();
    expect(screen.getByText('Jobs produced')).toBeInTheDocument();
    expect(screen.getAllByText(SCHEDULE.cron).length).toBeGreaterThan(0);

    // The jobs table is narrowed to this schedule — the whole point of the page.
    await waitFor(() => {
      const jobsRequest = h.requests.find((r) => r.url === '/jobs');
      expect(jobsRequest?.params).toMatchObject({ scheduleId: SCHEDULE.scheduleId });
    });
  });
});

describe('schedules page', () => {
  it('links each schedule id to its detail page', async () => {
    harness().renderApp('#/schedules');
    const link = await screen.findByRole('link', { name: SCHEDULE.scheduleId });
    expect(link).toHaveAttribute('href', `#/schedules/${SCHEDULE.scheduleId}`);
  });

  it('shows an error state when the schedules query fails', async () => {
    harness({ failures: { '/schedules': { status: 500 } } }).renderApp('#/schedules');
    expect(await screen.findByText('Could not load schedules')).toBeInTheDocument();
  });
});

describe('instances page', () => {
  const INSTANCE = {
    instanceKey: 'worker-eu-1',
    processingPaused: false,
    alive: true,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:02:00.000Z',
    lastSeenAt: '2026-07-22T00:02:00.000Z',
    cpuPercent: 12.5,
    memoryPercent: 94.2,
    counts: { COMPLETED: 8, FAILED: 1 },
  };

  it('teaches how to name an instance when none are registered', async () => {
    harness().renderApp('#/instances');
    expect(await screen.findByText('No instances registered.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Scaling horizontally/ })).toBeInTheDocument();
  });

  it('shows an error state when the instances query fails', async () => {
    harness({ failures: { '/instances': { status: 500 } } }).renderApp('#/instances');
    expect(await screen.findByText('Could not load instances')).toBeInTheDocument();
  });

  it('lists process health and a single processed total rather than a per-status breakdown', async () => {
    harness({ responses: { ...RESPONSES, '/instances': page([INSTANCE]) } }).renderApp(
      '#/instances',
    );
    expect(await screen.findByText('worker-eu-1')).toBeInTheDocument();
    expect(screen.getByText('12.5%')).toBeInTheDocument();
    expect(screen.getByText('94.2%')).toBeInTheDocument();
    // The headers name their subject, so a reader who never hovers still knows whose numbers these
    // are — and there is no per-process byte figure.
    expect(screen.getByRole('columnheader', { name: 'CPU (process)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Memory (process)' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'RSS' })).not.toBeInTheDocument();
    // Total processed only — the eight per-status columns belong to the detail page's table.
    expect(screen.getByRole('columnheader', { name: 'Processed' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Completed' })).not.toBeInTheDocument();
  });

  it('opens an instance’s own page with process health cards and the jobs it processed', async () => {
    // Only the by-key response: the stub matches the first key the URL starts with, so a
    // `/instances` entry would shadow `/instances/worker-eu-1`.
    harness({
      responses: { ...RESPONSES, '/instances/worker-eu-1': INSTANCE },
    }).renderApp('#/instances/worker-eu-1');

    // The cards name their subject: these are the Node process's numbers, not the host's.
    expect(await screen.findByText('CPU (process)')).toBeInTheDocument();
    expect(screen.getByText('Memory (process)')).toBeInTheDocument();
    expect(screen.queryByText('RSS')).not.toBeInTheDocument();
    expect(screen.getByText('Processed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Jobs processed' })).toBeInTheDocument();
    expect(screen.getByText('12.5%')).toBeInTheDocument();
    expect(screen.getByText('94.2%')).toBeInTheDocument();
  });

  it('says on hover that the health cards read this process, not the machine', async () => {
    harness({
      responses: { ...RESPONSES, '/instances/worker-eu-1': INSTANCE },
    }).renderApp('#/instances/worker-eu-1');

    // The tooltip's trigger is the wrapper around the card body, so hover it rather than the label.
    const cpuCard = (await screen.findByText('CPU (process)')).closest('span');
    fireEvent.mouseEnter(cpuCard!);

    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(/this Node process/i);
    expect(tip).toHaveTextContent(/not the machine/i);
  });

  it('asks the server only for the jobs this instance claimed', async () => {
    const h = harness({
      responses: { ...RESPONSES, '/instances/worker-eu-1': INSTANCE },
    });
    h.renderApp('#/instances/worker-eu-1');
    await screen.findByText('CPU (process)');
    await waitFor(() =>
      expect(
        h.requests.some((r) => r.url.includes('/jobs') && r.params.instanceKey === 'worker-eu-1'),
      ).toBe(true),
    );
  });
});
