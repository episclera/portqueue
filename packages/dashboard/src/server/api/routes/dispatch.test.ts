/**
 * How the router dispatches, before any route runs.
 *
 * Reads match a path against the route registry; mutations match the segment after `/api/actions/`
 * against the action registry. Both are lookups over a list, so an unknown path or action is a miss
 * rather than a fall-through into whichever handler happened to be last — which is the whole reason
 * the registries replaced a chain of `if (path === …)` and a `switch` over twelve kinds.
 *
 * The CSRF guard is checked here too, because it is the router's own: a mutation without the
 * dashboard client's marker header never reaches an action.
 * @jest-environment node
 */
import {
  failingClient,
  fakePq,
  postAction,
  postRaw,
  request,
  stubClient,
} from '../../../test-support/api';
import { ACTIONS, ACTIONS_BY_KIND, ROUTES } from './index';
import { ActionKind } from '../../../shared/dto';
import { REQUESTED_WITH_HEADER, REQUESTED_WITH_MARKER } from '../../../shared/constants';

describe('the registries', () => {
  it('covers every ActionKind exactly once', () => {
    // A kind with no route is a button in the UI that 404s; two routes for one kind is a silent
    // winner. The registry is the only place either can be caught.
    expect(ACTIONS_BY_KIND.size).toBe(ACTIONS.length);
    expect([...ACTIONS_BY_KIND.keys()].sort()).toEqual([...Object.values(ActionKind)].sort());
  });

  it('gives every route and action a summary, so the list is the API index', () => {
    expect(ROUTES.every((route) => route.summary.length > 0)).toBe(true);
    expect(ACTIONS.every((action) => action.summary.length > 0)).toBe(true);
  });

  it('matches a literal path exactly, not as a prefix', async () => {
    const { pq } = fakePq();
    const client = stubClient(pq);
    expect((await request(client, { method: 'GET', url: '/portqueue/api/config' })).status).toBe(
      200,
    );
    expect(
      (await request(client, { method: 'GET', url: '/portqueue/api/config/extra' })).status,
    ).toBe(404);
  });

  it('decodes a captured path segment, so an id with a space still resolves', async () => {
    // An id reaches the URL percent-encoded; a route that forgot to decode would look up a different
    // row (and, for a 404-on-miss route, always 404).
    const seen: string[] = [];
    const pq = {
      getJob: async ({ jobId }: { jobId: string }) => {
        seen.push(jobId);
        return null;
      },
    } as never;
    const res = await request(stubClient(pq), {
      method: 'GET',
      url: `/portqueue/api/jobs/${encodeURIComponent('job 1')}`,
    });
    expect(seen).toEqual(['job 1']);
    expect(res.status).toBe(404);
  });

  it('gives each action its own endpoint, so one URL means one mutation', async () => {
    const { pq, rec } = fakePq();
    await postAction(pq, { kind: ActionKind.PAUSE, queue: 'emails' });
    await postAction(pq, { kind: ActionKind.RESUME, queue: 'emails' });
    expect(rec.calls).toEqual(['pauseQueue', 'resumeQueue']);
  });
});

describe('the CSRF guard', () => {
  const url = `/portqueue/api/actions/${ActionKind.PAUSE}`;
  const body = JSON.stringify({ queue: 'emails' });

  it('refuses a mutation with no marker header', async () => {
    // The whole point: a cross-site form post or simple `fetch` arrives without this header, so an
    // operator's cookies (or replayed basic credentials) cannot be used to pause a queue.
    const { pq, rec } = fakePq();
    const res = await request(stubClient(pq), { method: 'POST', url, body, headers: {} });
    expect(res.status).toBe(403);
    expect(rec.calls).toEqual([]);
  });

  it('refuses a mutation whose marker is wrong', async () => {
    const { pq, rec } = fakePq();
    const res = await request(stubClient(pq), {
      method: 'POST',
      url,
      body,
      headers: { [REQUESTED_WITH_HEADER]: 'XMLHttpRequest' },
    });
    expect(res.status).toBe(403);
    expect(rec.calls).toEqual([]);
  });

  it('accepts a mutation carrying the marker', async () => {
    const { pq, rec } = fakePq();
    const res = await request(stubClient(pq), {
      method: 'POST',
      url,
      body,
      headers: { [REQUESTED_WITH_HEADER]: REQUESTED_WITH_MARKER },
    });
    expect(res.status).toBe(200);
    expect(rec.calls).toEqual(['pauseQueue']);
  });

  it('leaves reads alone, so the JSON API is still readable with curl', async () => {
    const { pq } = fakePq();
    const res = await request(stubClient(pq), {
      method: 'GET',
      url: '/portqueue/api/config',
      headers: {},
    });
    expect(res.status).toBe(200);
  });
});

describe('malformed and unroutable requests', () => {
  it('rejects a body that is not JSON', async () => {
    const { pq } = fakePq();
    expect((await postRaw(pq, ActionKind.PAUSE, 'not json')).status).toBe(400);
  });

  it('rejects a missing body', async () => {
    const { pq } = fakePq();
    expect((await postRaw(pq, ActionKind.PAUSE, undefined)).status).toBe(400);
  });

  it('404s an unknown action endpoint', async () => {
    const { pq } = fakePq();
    expect((await postAction(pq, { kind: 'nonsense', queue: 'emails' })).status).toBe(404);
  });

  it('404s the bare actions path, which names no mutation', async () => {
    const { pq } = fakePq();
    const res = await request(stubClient(pq), {
      method: 'POST',
      url: '/portqueue/api/actions',
      body: '{}',
    });
    expect(res.status).toBe(404);
  });

  it('404s an unknown path and an unsupported method', async () => {
    const { pq } = fakePq();
    const client = stubClient(pq);
    expect((await request(client, { method: 'GET', url: '/portqueue/api/nope' })).status).toBe(404);
    expect((await request(client, { method: 'DELETE', url: '/portqueue/api/jobs' })).status).toBe(
      404,
    );
  });

  it('answers 503 with the reason when the database is unreachable', async () => {
    // Connecting lazily means a bad connection string surfaces here, where the client can retry,
    // rather than crashing the mount, where the host could do nothing about it.
    const res = await request(failingClient(new Error('ECONNREFUSED 127.0.0.1:5432')), {
      method: 'GET',
      url: '/portqueue/api/queues',
    });
    expect(res.status).toBe(503);
    expect((JSON.parse(res.body) as { error: string }).error).toContain('ECONNREFUSED');
  });
});
