/**
 * The jobs routes: what they forward to core's dashboard facade, and how they shape the reply.
 *
 * The filtering itself — search included — happens in the database, inside
 * `pq._dashboard.getJobs`. What is left for a route to get wrong is the query string: parsing it,
 * clamping it, and dropping values that mean nothing. That is what these cover.
 * @jest-environment node
 */
import type { JobSnapshot, PortQueue } from '@portqueue/core';
import { request, stubClient } from '../../../test-support/api';
import type { JobPageDto } from '../../../shared/dto';

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

/** The shape the route hands to `pq._dashboard.getJobs`. */
interface FacadeQuery {
  queue?: string;
  statuses?: string[];
  scheduleId?: string;
  limit?: number;
  offset?: number;
  search?: string;
}

/** A PortQueue whose facade records the query it was handed and replays a fixed page. */
function fakePq(
  items: JobSnapshot[],
  extra: { total?: number } = {},
): { pq: PortQueue; queries: FacadeQuery[] } {
  const queries: FacadeQuery[] = [];
  const pq = {
    _dashboard: {
      getJobs: async (query: FacadeQuery) => {
        queries.push(query);
        return {
          items,
          total: extra.total ?? items.length,
        };
      },
    },
  } as unknown as PortQueue;
  return { pq, queries };
}

const read = async (pq: PortQueue, url: string): Promise<JobPageDto> => {
  const res = await request(stubClient(pq), { method: 'GET', url });
  expect(res.status).toBe(200);
  return JSON.parse(res.body) as JobPageDto;
};

describe('GET /api/jobs', () => {
  it('forwards limit + offset to core and returns the total for numbered pagination', async () => {
    const { pq, queries } = fakePq([job('a'), job('b')], { total: 47 });
    const page = await read(pq, '/portqueue/api/jobs?queue=emails&limit=20&offset=40');

    expect(queries[0]).toMatchObject({ queue: 'emails', limit: 20, offset: 40 });
    expect(page.total).toBe(47);
    expect(page.items.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('clamps a negative offset to zero and an absurd limit to the ceiling', async () => {
    const { pq, queries } = fakePq([]);
    await read(pq, '/portqueue/api/jobs?offset=-5&limit=100000');
    expect(queries[0]?.offset).toBe(0);
    expect(queries[0]?.limit).toBe(200);
  });

  it('parses the status filter into an array, dropping values that are not statuses', async () => {
    const { pq, queries } = fakePq([]);
    await read(pq, '/portqueue/api/jobs?statuses=failed,bogus,ACTIVE');
    expect(queries[0]?.statuses).toEqual(['FAILED', 'ACTIVE']);
  });

  it('forwards a scheduleId filter, which the schedule detail page relies on', async () => {
    const { pq, queries } = fakePq([]);
    await read(pq, '/portqueue/api/jobs?scheduleId=sch-1');
    expect(queries[0]?.scheduleId).toBe('sch-1');
  });

  it('passes the search term through to the database', async () => {
    const { pq, queries } = fakePq([job('alpha-1')]);
    await read(pq, '/portqueue/api/jobs?search=alpha');
    expect(queries[0]?.search).toBe('alpha');
  });

  it('treats a blank filter as absent rather than as an empty match', async () => {
    // `?queue=&search=` is what an emptied form field posts. Forwarding `''` would ask core to match
    // the empty string, which finds nothing — the opposite of what clearing a filter means.
    const { pq, queries } = fakePq([]);
    await read(pq, '/portqueue/api/jobs?queue=&search=&scheduleId=&statuses=');
    expect(Object.keys(queries[0] ?? {}).sort()).toEqual(['limit', 'offset']);
  });
});
