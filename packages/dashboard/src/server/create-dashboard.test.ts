/** @jest-environment node */
import type { PortQueue } from '@portqueue/core';
import { createDashboard } from './create-dashboard.js';
import { createEngine } from './engine.js';
import { makeReq, makeRes } from '../test-support/http-mocks.js';

// The engine only touches the PortQueue on API/SSE paths; asset + auth paths do not.
const fakePq = { getQueues: async () => [], on: () => {} } as unknown as PortQueue;

describe('createDashboard', () => {
  it('exposes a handler per framework and a normalized basePath', () => {
    const dash = createDashboard({ portQueue: fakePq, basePath: 'admin/' });
    expect(dash.basePath).toBe('/admin');
    for (const key of ['node', 'express', 'koa', 'fastify', 'nest'] as const) {
      expect(typeof dash[key]).toBe('function');
    }
  });

  it('node handler returns false for an unrelated URL and true for an owned one', () => {
    const handler = createDashboard({ portQueue: fakePq }).node();
    expect(handler(makeReq({ url: '/other' }), makeRes())).toBe(false);
    expect(handler(makeReq({ url: '/portqueue' }), makeRes())).toBe(true);
  });
});

describe('engine.serve', () => {
  it('serves the SPA shell for the mount root', async () => {
    const engine = createEngine({ portQueue: fakePq });
    const res = makeRes();
    await engine.serve(makeReq({ url: '/portqueue' }), res);
    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toContain('PortQueue Dashboard'); // default title
  });

  it('returns 401 with a challenge when Basic auth is required and absent', async () => {
    const engine = createEngine({
      portQueue: fakePq,
      auth: { mode: 'basic', username: 'u', password: 'p' },
    });
    const res = makeRes();
    await engine.serve(makeReq({ url: '/portqueue' }), res);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Basic realm=/);
  });

  it('reports ownership via owns()', () => {
    const engine = createEngine({ portQueue: fakePq });
    expect(engine.owns('/portqueue')).toBe(true);
    expect(engine.owns('/portqueue/api/queues')).toBe(true);
    expect(engine.owns('/other')).toBe(false);
    expect(engine.owns(undefined)).toBe(false);
  });
});
