/** @jest-environment node */
import type { PortQueue } from '@portqueue/core';
import { createDashboard } from './create-dashboard';
import { createEngine } from './engine';
import { makeReq, makeRes } from '../test-support/http-mocks';
import type { KoaContext } from './types';

/** The engine only reaches the PortQueue on API paths; asset paths never touch it. */
const fakePq = {
  _dashboard: { getQueues: async () => ({ items: [], total: 0 }) },
} as unknown as PortQueue;

/** Silence the "no client bundle" warning the engine emits at mount time in these tests. */
const quiet = { warn: () => {} };

/**
 * Poll until `check` passes. Serving hands off to an async routine that awaits several `stat`
 * calls, so a single tick is not enough to see the response land.
 */
async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the response');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('createDashboard', () => {
  it('exposes a handler per framework and a normalized basePath', () => {
    const dash = createDashboard({ portQueue: fakePq, basePath: 'admin/', logger: quiet });
    expect(dash.basePath).toBe('/admin');
    for (const key of ['node', 'express', 'koa', 'fastify', 'nest'] as const) {
      expect(typeof dash[key]).toBe('function');
    }
  });
});

describe('engine.serve', () => {
  it('serves the SPA shell for the mount root', async () => {
    const engine = createEngine({ portQueue: fakePq, logger: quiet });
    const res = makeRes();
    await engine.serve(makeReq({ url: '/portqueue' }), res);
    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toContain('PortQueue Dashboard'); // default title
  });

  it('sets the hardening headers on every response', async () => {
    const engine = createEngine({ portQueue: fakePq, logger: quiet });
    const res = makeRes();
    await engine.serve(makeReq({ url: '/portqueue' }), res);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('serves the API without demanding credentials — auth is the host’s job', async () => {
    const engine = createEngine({ portQueue: fakePq, logger: quiet });
    const res = makeRes();
    await engine.serve(makeReq({ url: '/portqueue/api/queues' }), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(res.body))).toEqual({ items: [], total: 0 });
  });

  it('warns once at mount time when no client bundle is packaged', async () => {
    // A missing bundle otherwise serves the fallback shell with a 200, which reads as a working
    // deploy — this warning is the only signal a misconfigured install gets.
    const warnings: string[] = [];
    createEngine({ portQueue: fakePq, logger: { warn: (m) => warnings.push(String(m)) } });
    await until(() => warnings.length > 0);
    expect(warnings.join('\n')).toContain('No client bundle found');
  });

  it('reports ownership via owns()', () => {
    const engine = createEngine({ portQueue: fakePq, logger: quiet });
    expect(engine.owns('/portqueue')).toBe(true);
    expect(engine.owns('/portqueue/api/queues')).toBe(true);
    expect(engine.owns('/other')).toBe(false);
    expect(engine.owns(undefined)).toBe(false);
  });
});

/**
 * Adapter coverage. The sandbox blocks listening on a port, so each adapter is driven with the
 * in-process `(req, res)` mocks instead — enough to prove it routes owned URLs into the engine
 * and passes everything else along, which is the whole of an adapter's job.
 */
describe('adapters', () => {
  const dashboard = (): ReturnType<typeof createDashboard> =>
    createDashboard({ portQueue: fakePq, logger: quiet });

  describe('node', () => {
    it('returns false for an unrelated URL and true for an owned one', () => {
      const handler = dashboard().node();
      expect(handler(makeReq({ url: '/other' }), makeRes())).toBe(false);
      expect(handler(makeReq({ url: '/portqueue' }), makeRes())).toBe(true);
    });
  });

  describe('express', () => {
    it('passes an unowned URL to next() without touching the response', () => {
      const middleware = dashboard().express();
      const res = makeRes();
      let nexted = false;
      middleware(makeReq({ url: '/other' }), res, () => {
        nexted = true;
      });
      expect(nexted).toBe(true);
      expect(res.ended).toBe(false);
    });

    it('serves an owned URL and does not call next()', async () => {
      const middleware = dashboard().express();
      const res = makeRes();
      let nexted = false;
      middleware(makeReq({ url: '/portqueue' }), res, () => {
        nexted = true;
      });
      await until(() => res.ended);
      expect(nexted).toBe(false);
      expect(res.statusCode).toBe(200);
    });

    it('reconstructs the mount path from originalUrl, which Express strips', async () => {
      // Mounted with `app.use('/portqueue', …)`, req.url arrives as '/api/queues'. Without the
      // originalUrl fix-up the router never sees an /api/ path and serves the shell instead.
      const middleware = dashboard().express();
      const res = makeRes();
      const req = makeReq({ url: '/api/queues' });
      (req as unknown as { originalUrl: string }).originalUrl = '/portqueue/api/queues';
      middleware(req, res, () => {});
      await until(() => res.ended);
      expect(res.headers['content-type']).toContain('application/json');
    });
  });

  describe('koa', () => {
    it('awaits next() for an unowned URL', async () => {
      const middleware = dashboard().koa();
      const ctx = { req: makeReq({ url: '/other' }), res: makeRes() } as unknown as KoaContext;
      let nexted = false;
      await middleware(ctx, async () => {
        nexted = true;
      });
      expect(nexted).toBe(true);
    });

    it('takes over the raw response for an owned URL', async () => {
      const middleware = dashboard().koa();
      const res = makeRes();
      const ctx = { req: makeReq({ url: '/portqueue' }), res } as unknown as KoaContext;
      await middleware(ctx, async () => {});
      // `respond: false` is what stops Koa overwriting what the engine already wrote.
      expect(ctx.respond).toBe(false);
      expect(res.statusCode).toBe(200);
    });
  });

  describe('fastify', () => {
    type Hook = (req: { raw: never }, reply: { raw: never; hijack: () => void }) => void;

    it('hijacks the reply for an owned URL and leaves others alone', async () => {
      const plugin = dashboard().fastify();
      let hook: Hook | null = null;
      let done = false;
      plugin(
        {
          addHook: (_name: string, fn: unknown) => {
            hook = fn as Hook;
          },
        } as never,
        {},
        () => {
          done = true;
        },
      );
      expect(done).toBe(true);
      expect(hook).not.toBeNull();
      const onRequest = hook as unknown as Hook;

      let hijacked = false;
      const ownedRes = makeRes();
      onRequest(
        { raw: makeReq({ url: '/portqueue' }) as never },
        {
          raw: ownedRes as never,
          hijack: () => {
            hijacked = true;
          },
        },
      );
      await until(() => ownedRes.ended);
      expect(hijacked).toBe(true);
      expect(ownedRes.statusCode).toBe(200);

      let otherHijacked = false;
      const otherRes = makeRes();
      onRequest(
        { raw: makeReq({ url: '/other' }) as never },
        {
          raw: otherRes as never,
          hijack: () => {
            otherHijacked = true;
          },
        },
      );
      expect(otherHijacked).toBe(false);
      expect(otherRes.ended).toBe(false);
    });
  });

  describe('nest', () => {
    it('behaves as Express middleware, which is what platform-express expects', async () => {
      const middleware = dashboard().nest();
      const res = makeRes();
      middleware(makeReq({ url: '/portqueue' }), res, () => {});
      await until(() => res.ended);
      expect(res.statusCode).toBe(200);
    });
  });
});
