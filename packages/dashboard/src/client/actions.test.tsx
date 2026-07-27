/**
 * Behavioural tests for the mutating controls: every row action, popover confirmation and bulk
 * action must reach `POST /api/actions` with the right body — and, since the overlays render
 * through body portals, the confirmation and menu layers must be reachable from `document.body`
 * rather than from inside the (clipped, scrollable) table.
 *
 * The bulk cases matter most here: a batch is now **one** request carrying every id, so the
 * server can apply it in a single transaction. It used to be N sequential requests.
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ActionKind } from '../shared/dto';
import { createHarness, page, type StubOptions } from '../test-support/render';

const QUEUES = page([
  {
    name: 'emails',
    processingPaused: false,
    acceptingPaused: false,
    inUse: true,
    counts: { PENDING: 1, ACTIVE: 0, COMPLETED: 3, FAILED: 1, RETRY: 0 },
  },
]);

const STATS = { counts: { ACTIVE: 0, RETRY: 0, FAILED: 1, COMPLETED: 8, STALLED: 0 } };

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

const SCHEDULE = {
  scheduleId: 'sch-1',
  queue: 'emails',
  cron: '0 0 * * *',
  everySeconds: null,
  timezone: 'UTC',
  nextRunAt: '2026-07-23T00:00:00.000Z',
  lastRunAt: null,
  enabled: true,
};

/** The clone the server hands back — a second record, with its own detail page. */
const CLONE = { ...JOB, id: 'job-cloned-999' };

/** Unseen for an hour, so core would accept a removal — "removable" is a question about now. */
const INSTANCE = {
  instanceKey: 'worker-eu-1',
  processingPaused: false,
  alive: true,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:02:00.000Z',
  lastSeenAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  cpuPercent: 12.5,
  memoryPercent: 30,
  counts: { COMPLETED: 8 },
};

const RESPONSES: Record<string, unknown> = {
  '/queues': QUEUES,
  '/stats': STATS,
  '/jobs': { items: [JOB], total: 1 },
  [`/jobs/${JOB.id}`]: JOB,
  [`/jobs/${CLONE.id}`]: CLONE,
  '/schedules': page([SCHEDULE]),
  [`/schedules/${SCHEDULE.scheduleId}`]: SCHEDULE,
  '/instances': page([]),
};

const harness = (over: StubOptions = {}) => createHarness({ responses: RESPONSES, ...over });

/** Open one instance's detail page, optionally overriding the record it shows. */
const openInstance = (over: Partial<typeof INSTANCE> = {}): ReturnType<typeof harness> => {
  const h = harness({
    responses: { ...RESPONSES, [`/instances/${INSTANCE.instanceKey}`]: { ...INSTANCE, ...over } },
  });
  h.renderApp(`#/instances/${INSTANCE.instanceKey}`);
  return h;
};

/** The row-action icon button (its label lives in `aria-label`, not in the glyph). */
function rowAction(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

beforeEach(() => window.localStorage.clear());

describe('job row actions', () => {
  it('retries a job straight away (no confirmation)', async () => {
    const h = harness();
    h.renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Retry'));

    await waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.posts[0]?.url).toBe('/actions');
    // A single id travels the same batch path as a bulk action — one is the trivial case.
    expect(h.lastAction()).toEqual({
      kind: ActionKind.RETRY,
      queue: 'emails',
      jobId: JOB.id,
    });
  });

  it('cancels a job through its confirmation popover, which renders in a body portal', async () => {
    const h = harness();
    h.renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Cancel'));

    const popover = await screen.findByRole('dialog');
    expect(popover).toHaveTextContent('Cancel this job?');
    // Portalled: a direct child of <body>, not of the scrollable table wrapper.
    expect(popover.parentElement).toBe(document.body);

    fireEvent.click(within(popover).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.lastAction()).toEqual({
      kind: ActionKind.CANCEL,
      queue: 'emails',
      jobId: JOB.id,
    });
  });

  it('dismisses the confirmation popover without acting when the user backs out', async () => {
    const h = harness();
    h.renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Remove'));
    const popover = await screen.findByRole('dialog');
    fireEvent.click(within(popover).getByRole('button', { name: 'Keep' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(h.posts).toHaveLength(0);
  });

  it('removes a job through its confirmation popover', async () => {
    const h = harness();
    h.renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Remove'));
    const popover = await screen.findByRole('dialog');
    expect(popover).toHaveTextContent('Remove this job permanently?');

    fireEvent.click(within(popover).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.lastAction()).toEqual({
      kind: ActionKind.REMOVE,
      queue: 'emails',
      jobId: JOB.id,
    });
  });

  it('closes the popover on Escape and on an outside click', async () => {
    const h = harness();
    h.renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Remove'));
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(rowAction('Remove'));
    await screen.findByRole('dialog');
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(h.posts).toHaveLength(0);
  });
});

describe('bulk job actions', () => {
  it('sends one request carrying every selected id, not one request per job', async () => {
    const h = harness();
    h.renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(screen.getByLabelText(`Select row ${JOB.id}`));
    fireEvent.click(await screen.findByRole('button', { name: /Bulk actions \(1\)/ }));

    const menu = await screen.findByRole('menu');
    expect(menu.parentElement).toBe(document.body);

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Retry selected/ }));

    await waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.lastAction()).toEqual({
      kind: ActionKind.RETRY,
      queue: 'emails',
      jobIds: [JOB.id],
    });
  });

  it('asks for confirmation in a modal before a bulk remove', async () => {
    const h = harness();
    h.renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(screen.getByLabelText(`Select row ${JOB.id}`));
    fireEvent.click(await screen.findByRole('button', { name: /Bulk actions \(1\)/ }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Remove selected/ }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Remove 1 job(s)?');
    expect(h.posts).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.lastAction()).toEqual({
      kind: ActionKind.REMOVE,
      queue: 'emails',
      jobIds: [JOB.id],
    });
  });

  it('reports a partial batch once, naming both numbers', async () => {
    // The server acted on fewer rows than were asked for — a settled job, a vanished one, an
    // ACTIVE row a removal refuses. One summary beats N toasts and beats claiming all succeeded.
    const h = harness({ actionResult: { ok: true, affected: 1, requested: 3 } });
    h.renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(screen.getByLabelText(`Select row ${JOB.id}`));
    fireEvent.click(await screen.findByRole('button', { name: /Bulk actions \(1\)/ }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Retry selected/ }));

    expect(await screen.findByText('Requeued 1 of 3 jobs.')).toBeInTheDocument();
  });

  it('surfaces the server’s own message when a batch fails', async () => {
    const h = harness({
      failures: { '/actions': { status: 409, body: { error: 'queue is paused' } } },
    });
    h.renderApp('#/queues/emails');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Retry'));

    expect(await screen.findByText('queue is paused')).toBeInTheDocument();
  });
});

describe('queue row actions', () => {
  it('pauses a queue from the overview table, after its confirmation popover', async () => {
    const h = harness();
    h.renderApp('#/');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Pause'));
    const popover = await screen.findByRole('dialog');
    expect(popover).toHaveTextContent('Pause processing on this queue?');

    fireEvent.click(within(popover).getByRole('button', { name: 'Pause' }));

    await waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.lastAction()).toMatchObject({ kind: ActionKind.PAUSE, queue: 'emails' });
  });
});

describe('schedule actions', () => {
  it('disables a schedule rather than only offering removal', async () => {
    // Disabling is the reversible alternative; remove was previously the only action available.
    const h = harness();
    h.renderApp('#/schedules');
    await screen.findByText('Results (1)');

    fireEvent.click(rowAction('Disable'));
    const popover = await screen.findByRole('dialog');
    fireEvent.click(within(popover).getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.lastAction()).toEqual({
      kind: ActionKind.SET_SCHEDULE_ENABLED,
      queue: 'emails',
      scheduleId: SCHEDULE.scheduleId,
      enabled: false,
    });
  });

  it('removes selected schedules in one request', async () => {
    const h = harness();
    h.renderApp('#/schedules');
    await screen.findByText('Results (1)');

    fireEvent.click(screen.getByLabelText(`Select row ${SCHEDULE.scheduleId}`));
    fireEvent.click(await screen.findByRole('button', { name: /Bulk actions \(1\)/ }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Remove selected/ }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.lastAction()).toEqual({
      kind: ActionKind.REMOVE_SCHEDULE,
      scheduleIds: [SCHEDULE.scheduleId],
    });
  });
});

describe('detail page redirects', () => {
  /**
   * An action that destroys or replaces the record a detail page is about has to move the user:
   * staying put leaves them on a URL that either no longer resolves or still describes the old
   * record. These assert the destination, since that is the whole behaviour.
   */
  it('follows the clone to its own job page', async () => {
    const h = harness({ actionResult: { ok: true, jobId: CLONE.id } });
    h.renderApp(`#/jobs/${JOB.id}`);
    await screen.findByRole('button', { name: /Clone/ });

    fireEvent.click(screen.getByRole('button', { name: /Clone/ }));
    const modal = await screen.findByRole('dialog');
    fireEvent.click(within(modal).getByRole('button', { name: 'Add job' }));

    await waitFor(() => expect(window.location.hash).toBe(`#/jobs/${CLONE.id}`));
  });

  it('follows a cloned recurring definition to its schedule page', async () => {
    const h = harness({ actionResult: { ok: true, scheduleId: SCHEDULE.scheduleId } });
    h.renderApp(`#/jobs/${JOB.id}`);
    await screen.findByRole('button', { name: /Clone/ });

    fireEvent.click(screen.getByRole('button', { name: /Clone/ }));
    const modal = await screen.findByRole('dialog');
    fireEvent.click(within(modal).getByRole('tab', { name: 'Recurring' }));
    fireEvent.change(within(modal).getByLabelText(/Cron expression/), {
      target: { value: '0 * * * *' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Create schedule' }));

    await waitFor(() => expect(window.location.hash).toBe(`#/schedules/${SCHEDULE.scheduleId}`));
  });

  it('leaves for the queue after the job is removed', async () => {
    const h = harness({ actionResult: { ok: true, affected: 1 } });
    h.renderApp(`#/jobs/${JOB.id}`);
    await screen.findByRole('button', { name: /Remove/ });

    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    const popover = await screen.findByRole('dialog');
    fireEvent.click(within(popover).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(window.location.hash).toBe(`#/queues/${JOB.queue}`));
  });

  it('stays put, and says why, when the removal was refused', async () => {
    // Core never removes a running job. Redirecting on a refusal would claim it was gone.
    const h = harness({ actionResult: { ok: false, affected: 0 } });
    h.renderApp(`#/jobs/${JOB.id}`);
    await screen.findByRole('button', { name: /Remove/ });

    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    const popover = await screen.findByRole('dialog');
    fireEvent.click(within(popover).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText(/still running/i)).toBeInTheDocument();
    expect(window.location.hash).toBe(`#/jobs/${JOB.id}`);
  });

  it('leaves for the schedules list after the schedule is removed', async () => {
    const h = harness();
    h.renderApp(`#/schedules/${SCHEDULE.scheduleId}`);
    // The page header's action, not the identically named one on a produced job's row below it.
    const [remove] = await screen.findAllByRole('button', { name: /Remove/ });

    fireEvent.click(remove!);
    const popover = await screen.findByRole('dialog');
    fireEvent.click(within(popover).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(window.location.hash).toBe('#/schedules'));
  });

  it('leaves for the instances list after the instance is removed', async () => {
    const h = openInstance();
    const [remove] = await screen.findAllByRole('button', { name: /^Remove$/ });

    fireEvent.click(remove!);
    const popover = await screen.findByRole('dialog');
    expect(popover).toHaveTextContent('Remove this inactive instance from monitoring?');
    fireEvent.click(within(popover).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(window.location.hash).toBe('#/instances'));
    expect(h.lastAction()).toMatchObject({
      kind: ActionKind.REMOVE_INSTANCE,
      instanceKey: INSTANCE.instanceKey,
    });
  });
});

describe('add job form', () => {
  /**
   * Open the modal and return it, so every query scopes to the dialog: the page header's
   * "Add job" trigger shares its accessible name with the modal's submit button.
   */
  const openForm = async (h: ReturnType<typeof harness>): Promise<HTMLElement> => {
    h.renderApp('#/queues/emails');
    await screen.findByText('Results (1)');
    const [trigger] = screen.getAllByRole('button', { name: /Add job/ });
    fireEvent.click(trigger!);
    return screen.findByRole('dialog');
  };

  it('refuses to submit invalid JSON, without a round trip', async () => {
    const h = harness();
    const modal = await openForm(h);

    fireEvent.change(within(modal).getByLabelText(/Data \(JSON\)/), {
      target: { value: '{oops' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Add job' }));

    await waitFor(() => expect(within(modal).getAllByRole('alert').length).toBeGreaterThan(0));
    expect(h.posts).toHaveLength(0);
  });

  it('requires a cadence in recurring mode instead of quietly adding a one-off job', async () => {
    // The old form attached no schedule fields when both were empty: the button said "Create
    // schedule", the toast said "Schedule created", and a plain job was added.
    const h = harness();
    const modal = await openForm(h);

    fireEvent.click(within(modal).getByRole('tab', { name: 'Recurring' }));
    fireEvent.click(within(modal).getByRole('button', { name: 'Create schedule' }));

    expect(await within(modal).findByText(/cron expression is required/i)).toBeInTheDocument();
    expect(h.posts).toHaveLength(0);
  });

  it('sends a one-off delay as a plain number of seconds', async () => {
    const h = harness();
    const modal = await openForm(h);

    fireEvent.change(within(modal).getByLabelText(/Start after \(seconds\)/), {
      target: { value: '30' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Add job' }));

    await waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.lastAction()).toMatchObject({ add: { startAfterSeconds: 30 } });
  });

  it('offers one way to delay a one-off job — a whole number of seconds', async () => {
    const h = harness();
    const modal = await openForm(h);

    // There is deliberately no second "start at a date" field: one option, one unit.
    expect(within(modal).queryByLabelText(/start at/i)).not.toBeInTheDocument();

    fireEvent.change(within(modal).getByLabelText(/Start after \(seconds\)/), {
      target: { value: '1.5' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Add job' }));

    expect(await within(modal).findByText(/whole number of seconds/i)).toBeInTheDocument();
    expect(h.posts).toHaveLength(0);
  });

  it('rejects a malformed cron expression at the field', async () => {
    const h = harness();
    const modal = await openForm(h);

    fireEvent.click(within(modal).getByRole('tab', { name: 'Recurring' }));
    fireEvent.change(within(modal).getByLabelText(/Cron expression/), {
      target: { value: '0 0 *' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Create schedule' }));

    expect(await within(modal).findByText(/has 3/)).toBeInTheDocument();
    expect(h.posts).toHaveLength(0);
  });

  it('submits a cron schedule once the cadence is valid', async () => {
    const h = harness();
    const modal = await openForm(h);

    fireEvent.click(within(modal).getByRole('tab', { name: 'Recurring' }));
    fireEvent.change(within(modal).getByLabelText(/Cron expression/), {
      target: { value: '0 * * * *' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Create schedule' }));

    await waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.lastAction()).toMatchObject({
      kind: ActionKind.ADD,
      queue: 'emails',
      add: { cron: '0 * * * *' },
    });
  });

  it('shows only the chosen cadence field, so both can never be empty at once', async () => {
    const h = harness();
    const modal = await openForm(h);

    fireEvent.click(within(modal).getByRole('tab', { name: 'Recurring' }));
    expect(within(modal).getByLabelText(/Cron expression/)).toBeInTheDocument();
    expect(within(modal).queryByLabelText(/Every \(seconds\)/)).not.toBeInTheDocument();

    fireEvent.click(within(modal).getByRole('tab', { name: 'Fixed interval' }));
    expect(within(modal).getByLabelText(/Every \(seconds\)/)).toBeInTheDocument();
    expect(within(modal).queryByLabelText(/Cron expression/)).not.toBeInTheDocument();
  });
});

describe('instance detail actions', () => {
  it('pauses this instance from the header, after its confirmation popover', async () => {
    const h = openInstance();
    // Exact names: the shell's live control is also called "Pause auto-updates".
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));

    const popover = await screen.findByRole('dialog');
    expect(popover).toHaveTextContent('Pause job processing on this instance?');
    fireEvent.click(within(popover).getByRole('button', { name: 'Pause' }));

    await waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.lastAction()).toMatchObject({
      kind: ActionKind.PAUSE_INSTANCE,
      instanceKey: INSTANCE.instanceKey,
    });
  });

  it('resumes a paused instance straight away (no confirmation)', async () => {
    const h = openInstance({ processingPaused: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.lastAction()).toMatchObject({
      kind: ActionKind.RESUME_INSTANCE,
      instanceKey: INSTANCE.instanceKey,
    });
  });

  it('keeps remove disabled while the instance is still being seen', async () => {
    // Core refuses one it heard from in the last half hour, so the button never offers it.
    const h = openInstance({ lastSeenAt: new Date().toISOString() });
    const [remove] = await screen.findAllByRole('button', { name: /^Remove$/ });

    expect(remove).toBeDisabled();
    fireEvent.click(remove!);
    expect(h.posts).toHaveLength(0);
  });
});
