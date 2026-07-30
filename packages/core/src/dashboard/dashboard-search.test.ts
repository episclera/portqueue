/**
 * The `pq._dashboard` job search. Its job is to be complete *and* cheap: the term is matched with a
 * `LIKE` **in SQL** across the five fields an operator triages by, so a match in the oldest row is
 * found without this process ever seeing the rows that didn't match, and `total` is a `COUNT` rather
 * than a running tally of a scan.
 *
 * The fixture spans more rows than any page, which is what the previous chunked-scan implementation
 * needed several round trips and a `JSON.parse` per row to cover.
 */
import { createTestQueue, type TestQueueHandle } from '../test-utils/create-test-queue';
import { JobStatus } from '../jobs/job-state.enum';

/** Comfortably more rows than a page, so a match at the far end has to be found by the query. */
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
    await h.pq.addJob({ queue: 'searched', data: { tag: 'needle-oldest' } });
    await h.pq.addJobs({
      queue: 'searched',
      jobs: Array.from({ length: ROWS - 1 }, (_, i) => ({ data: { tag: `filler-${i + 1}` } })),
    });
  }

  it('finds a match in the oldest row, far outside any single page', async () => {
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
    const first = await h.pq._dashboard.getJobs({
      queue: 'searched',
      search: 'filler-',
      limit: 20,
    });
    expect(first.total).toBe(ROWS - 1);
    expect(first.items).toHaveLength(20);

    // The final page of matches: short, nothing after it, and no overlap with the first.
    const last = await h.pq._dashboard.getJobs({
      queue: 'searched',
      search: 'filler-',
      limit: 20,
      offset: ROWS - 20,
    });
    expect(last.items).toHaveLength(19);
    expect(ROWS - 20 + last.items.length).toBe(last.total);
    const firstIds = first.items.map((j) => j.id);
    expect(last.items.every((j) => !firstIds.includes(j.id))).toBe(true);
  });

  it('searches only inside the other filters', async () => {
    await seed();
    await h.pq.addJob({ queue: 'elsewhere', data: { tag: 'needle-oldest' } });

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
    const res = await h.pq.addJob({
      queue: 'fields',
      data: { to: 'ada@example.com' },
      idempotencyKey: 'WELCOME-ada',
    });

    const byPayload = await h.pq._dashboard.getJobs({ queue: 'fields', search: 'ADA@example' });
    const byKey = await h.pq._dashboard.getJobs({ queue: 'fields', search: 'welcome-' });
    const byId = await h.pq._dashboard.getJobs({ queue: 'fields', search: res.jobId!.slice(0, 8) });

    expect([byPayload.total, byKey.total, byId.total]).toEqual([1, 1, 1]);
  });

  it('matches the failure message of a failed job', async () => {
    h.pq.createQueue({
      name: 'broken',
      limiter: { pollIntervalSeconds: 0.02 },
      handler: async () => {
        throw new Error('smtp connection refused');
      },
    });
    const res = await h.pq.addJob({ queue: 'broken', data: {} });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if ((await h.pq.getJob({ jobId: res.jobId! }))?.status === JobStatus.FAILED) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const found = await h.pq._dashboard.getJobs({ queue: 'broken', search: 'smtp connection' });
    expect(found.total).toBe(1);
    expect(found.items[0]!.id).toBe(res.jobId);
  });

  it('treats a LIKE metacharacter as text rather than a wildcard', async () => {
    await h.pq.addJob({ queue: 'escaped', data: { note: 'discount 100% off' } });
    await h.pq.addJob({ queue: 'escaped', data: { note: 'plain' } });
    // A bare `%` used to match everything; it now searches for that character.
    expect((await h.pq._dashboard.getJobs({ queue: 'escaped', search: '100%' })).total).toBe(1);
    expect((await h.pq._dashboard.getJobs({ queue: 'escaped', search: '%' })).total).toBe(1);
  });

  it('returns the plain paged read when there is no term', async () => {
    for (let i = 0; i < 3; i += 1) await h.pq.addJob({ queue: 'unsearched', data: { i } });
    const page = await h.pq._dashboard.getJobs({ queue: 'unsearched', limit: 2 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
  });
});
