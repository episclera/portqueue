/**
 * The `pq._dashboard` job search. Its one job is to be complete: the engine carries no text index,
 * so the term is matched in JS over a chunked scan of every row the other filters allow. These
 * tests pin that — a match in the oldest row is found, and `total` counts every match rather than
 * whatever fitted in one window.
 *
 * The scan chunk is 1000 rows, so the fixture deliberately spans more than one chunk.
 */
import { createTestQueue, type TestQueueHandle } from '../test-utils/create-test-queue';
import { JobStatus } from '../jobs/job-state.enum';

/** Rows either side of the chunk boundary, so the loop has to come back for more. */
const ROWS = 1200;

describe('dashboard job search (sqlite)', () => {
  let h: TestQueueHandle;
  beforeEach(async () => {
    h = await createTestQueue('sqlite');
  });
  afterEach(async () => {
    await h.cleanup();
  });

  /** `ROWS` jobs, oldest first, with the needle in the very first (so: last page of a desc scan). */
  async function seed(): Promise<void> {
    const q = h.pq.createQueue<{ tag: string }>('searched');
    await q.addJob({ data: { tag: 'needle-oldest' } });
    for (let i = 1; i < ROWS; i += 1) await q.addJob({ data: { tag: `filler-${i}` } });
  }

  it('finds a match in the oldest row, far outside any single scan chunk', async () => {
    await seed();
    const page = await h.pq._dashboard.getJobs<{ tag: string }>({
      queue: 'searched',
      search: 'needle-oldest',
      limit: 20,
    });
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.data.tag).toBe('needle-oldest');
  });

  it('counts every match in `total`, and pages through them', async () => {
    await seed();
    const first = await h.pq._dashboard.getJobs({ queue: 'searched', search: 'filler-', limit: 20 });
    expect(first.total).toBe(ROWS - 1);
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);

    // The final page of matches: short, nothing after it, and no overlap with the first.
    const last = await h.pq._dashboard.getJobs({
      queue: 'searched',
      search: 'filler-',
      limit: 20,
      offset: ROWS - 20,
    });
    expect(last.items).toHaveLength(19);
    expect(last.hasMore).toBe(false);
    const firstIds = first.items.map((j) => j.id);
    expect(last.items.every((j) => !firstIds.includes(j.id))).toBe(true);
  });

  it('searches only inside the other filters', async () => {
    await seed();
    await h.pq.createQueue<{ tag: string }>('elsewhere').addJob({ data: { tag: 'needle-oldest' } });

    const scoped = await h.pq._dashboard.getJobs({
      queue: 'searched',
      search: 'needle',
      limit: 20,
    });
    expect(scoped.total).toBe(1); // the other queue's identical row is out of scope

    const byStatus = await h.pq._dashboard.getJobs({
      queue: 'searched',
      statuses: [JobStatus.COMPLETED],
      search: 'needle',
      limit: 20,
    });
    expect(byStatus.total).toBe(0);
  });

  it('matches the payload, the idempotency key and the id, case-insensitively', async () => {
    const q = h.pq.createQueue<{ to: string }>('fields');
    const res = await q.addJob({ data: { to: 'ada@example.com' }, idempotencyKey: 'WELCOME-ada' });

    const byPayload = await h.pq._dashboard.getJobs({ queue: 'fields', search: 'ADA@example' });
    const byKey = await h.pq._dashboard.getJobs({ queue: 'fields', search: 'welcome-' });
    const byId = await h.pq._dashboard.getJobs({ queue: 'fields', search: res.jobId!.slice(0, 8) });

    expect([byPayload.total, byKey.total, byId.total]).toEqual([1, 1, 1]);
  });

  it('returns the plain paged read when there is no term', async () => {
    const q = h.pq.createQueue('unsearched');
    for (let i = 0; i < 3; i += 1) await q.addJob({ data: { i } });
    const page = await h.pq._dashboard.getJobs({ queue: 'unsearched', limit: 2 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
  });
});
