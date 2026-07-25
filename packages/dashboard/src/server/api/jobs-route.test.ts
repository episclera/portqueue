/**
 * The jobs route: numbered pagination (an `offset` forwarded to core plus the `total` core
 * reports) and the bounded search that filters a scanned window by job id / status.
 * @jest-environment node
 */
import type { GetJobsQuery, JobSnapshot, PortQueue } from '@portqueue/core';
import { createRouter } from './routes';
import type { JobPageDto } from '../../shared/dto';

const job = (id: string, status = 'COMPLETED'): JobSnapshot =>
  ({
    id,
    queue: 'emails',
    status,
    data: {},
    priority: 0,
    retryAttempt: 0,
    retryMaxAttempts: 3,
    createdAt: new Date('2026-07-22T00:00:00.000Z'),
    updatedAt: new Date('2026-07-22T00:00:00.000Z'),
    startAfter: new Date('2026-07-22T00:00:00.000Z'),
    stalled: false,
  }) as unknown as JobSnapshot;

/** A PortQueue whose getJobs records the query it was handed and replays a fixed page. */
function fakePq(
  items: JobSnapshot[],
  total = items.length,
): {
  pq: PortQueue;
  queries: GetJobsQuery[];
} {
  const queries: GetJobsQuery[] = [];
  const pq = {
    getJobs: async (query: GetJobsQuery) => {
      queries.push(query);
      return { items, cursor: null, hasMore: false, total };
    },
  } as unknown as PortQueue;
  return { pq, queries };
}

const read = async (pq: PortQueue, url: string): Promise<JobPageDto> => {
  const router = createRouter({ portQueue: pq, basePath: '/portqueue', readOnly: false });
  const res = await router.handle({ method: 'GET', url, body: undefined, headers: {} });
  expect(res.status).toBe(200);
  return JSON.parse(res.body) as JobPageDto;
};

describe('GET /api/jobs', () => {
  it('forwards limit + offset to core and returns the total for numbered pagination', async () => {
    const { pq, queries } = fakePq([job('a'), job('b')], 47);
    const page = await read(pq, '/portqueue/api/jobs?queue=emails&limit=20&offset=40');

    expect(queries[0]).toMatchObject({ queue: 'emails', limit: 20, offset: 40 });
    expect(page.total).toBe(47);
    expect(page.items.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('clamps a negative offset to zero', async () => {
    const { pq, queries } = fakePq([]);
    await read(pq, '/portqueue/api/jobs?offset=-5');
    expect(queries[0]?.offset).toBe(0);
  });

  describe('search', () => {
    const scanned = [job('alpha-1'), job('beta-2', 'FAILED'), job('alpha-3')];

    it('matches on job id and reports the matched total, not the scanned total', async () => {
      const { pq, queries } = fakePq(scanned, 999);
      const page = await read(pq, '/portqueue/api/jobs?search=alpha&limit=20&offset=0');

      // The scan ignores the requested offset and widens the limit to the scan window.
      expect(queries[0]).toMatchObject({ offset: 0 });
      expect(queries[0]?.limit).toBeGreaterThan(20);
      expect(page.items.map((j) => j.id)).toEqual(['alpha-1', 'alpha-3']);
      expect(page.total).toBe(2);
      expect(page.hasMore).toBe(false);
    });

    it('matches on status too', async () => {
      const { pq } = fakePq(scanned);
      const page = await read(pq, '/portqueue/api/jobs?search=failed');
      expect(page.items.map((j) => j.id)).toEqual(['beta-2']);
    });

    it('pages within the matched set', async () => {
      const { pq } = fakePq(scanned);
      const page = await read(pq, '/portqueue/api/jobs?search=alpha&limit=1&offset=1');
      expect(page.items.map((j) => j.id)).toEqual(['alpha-3']);
      expect(page.total).toBe(2);
      expect(page.hasMore).toBe(false);
    });

    it('flags hasMore while matches remain after the requested page', async () => {
      const { pq } = fakePq(scanned);
      const page = await read(pq, '/portqueue/api/jobs?search=alpha&limit=1&offset=0');
      expect(page.hasMore).toBe(true);
    });
  });
});
