/**
 * The five framework adapters, each driven through the **real** framework rather than a hand-made
 * `(req, res)` pair.
 *
 * That is the whole point of testing these: every adapter exists because a framework does something
 * to the request before a middleware sees it, and only the framework itself reproduces that. Express
 * strips the mount path from `req.url` (so the adapter rebuilds it from `originalUrl`), Koa expects a
 * middleware that opts out of its own response handling, and Fastify needs the reply hijacked before
 * anything is written to the raw socket. A mock would have agreed with whatever the adapter did.
 *
 * No port is bound anywhere: Express and Koa are driven through the handler they hand out, Fastify
 * through `inject()`.
 * @jest-environment node
 */
import express from 'express';
import Koa from 'koa';
import Fastify from 'fastify';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createDashboard } from './create-dashboard';
import { fakePq, stubClient } from '../test-support/api';
import { REQUESTED_WITH_HEADER, REQUESTED_WITH_MARKER } from '../shared/constants';
import type { Dashboard } from './types';

const BASE_PATH = '/portqueue';
const CONFIG_PATH = `${BASE_PATH}/api/config`;

/** A dashboard on a client that answers from a fake, so nothing here needs a database. */
function dashboard(): Dashboard {
  const { pq } = fakePq();
  return createDashboard({ driver: {} as never, client: stubClient(pq) });
}

/**
 * Drive a `(req, res)` handler with **real** `IncomingMessage`/`ServerResponse` objects, capturing
 * what was written instead of flushing it to a socket.
 *
 * Real prototypes rather than a mock, because Express and Koa reach for far more of them than a mock
 * would think to provide (`setHeader`, `getHeader`, `writeHead`, `req.socket`, …). No port is bound:
 * the response's `write`/`end` are the only place bytes would leave, and both are intercepted.
 */
function callHandler(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = new IncomingMessage(new Socket());
    req.method = 'GET';
    req.url = path;
    req.headers = { [REQUESTED_WITH_HEADER]: REQUESTED_WITH_MARKER, host: 'localhost' };
    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];
    res.write = ((chunk: unknown) => {
      if (chunk != null) chunks.push(Buffer.from(chunk as string));
      return true;
    }) as typeof res.write;
    res.end = ((chunk?: unknown) => {
      if (chunk != null && typeof chunk !== 'function') chunks.push(Buffer.from(chunk as string));
      resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      return res;
    }) as typeof res.end;
    res.on('error', reject);
    try {
      handler(req, res);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    // Nothing has a body, so the request stream ends immediately.
    req.push(null);
  });
}

describe('the Express adapter', () => {
  it('serves the API under the mount path Express stripped from req.url', async () => {
    // Express rewrites `req.url` relative to the mount, so an adapter that trusted it would look for
    // `/api/config` and find nothing. This is the case a mock cannot produce.
    const app = express();
    app.use(BASE_PATH, dashboard().express());
    const res = await request(app, CONFIG_PATH);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('mounted at the root, still only answers under its base path', async () => {
    const app = express();
    app.use(dashboard().express());
    app.use((_req, res) => void res.status(404).end('app-404'));
    expect((await request(app, CONFIG_PATH)).status).toBe(200);
    expect((await request(app, '/something-else')).body).toBe('app-404');
  });

  it('calls next() for a path it does not own, and restores req.url first', async () => {
    // The restore matters: the next middleware must see the URL Express gave it, not the one the
    // adapter rebuilt while deciding.
    const seen: string[] = [];
    const app = express();
    app.use(BASE_PATH, dashboard().express());
    app.use('/other', (req, res) => {
      seen.push(req.url);
      res.end('other');
    });
    const res = await request(app, '/other/thing');
    expect(res.body).toBe('other');
    expect(seen).toEqual(['/thing']);
  });
});

describe('the Koa adapter', () => {
  it('serves the API and takes over the response', async () => {
    const app = new Koa();
    app.use(dashboard().koa());
    const res = await callHandler(app.callback(), CONFIG_PATH);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('passes a path it does not own down the middleware chain', async () => {
    const app = new Koa();
    app.use(dashboard().koa());
    app.use(async (ctx) => {
      ctx.status = 418;
      ctx.body = 'downstream';
    });
    const res = await callHandler(app.callback(), '/elsewhere');
    expect(res.status).toBe(418);
    expect(res.body).toBe('downstream');
  });
});

describe('the Fastify adapter', () => {
  it('serves the API from a hijacked reply', async () => {
    // Fastify owns the response until `hijack()`; without it Fastify would also try to reply, and the
    // second write throws.
    const app = Fastify();
    await app.register(dashboard().fastify());
    const res = await app.inject({ method: 'GET', url: CONFIG_PATH });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    await app.close();
  });

  it('leaves a route it does not own to Fastify', async () => {
    const app = Fastify();
    await app.register(dashboard().fastify());
    app.get('/elsewhere', async () => ({ from: 'fastify' }));
    const res = await app.inject({ method: 'GET', url: '/elsewhere' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ from: 'fastify' });
    await app.close();
  });
});

describe('the Nest adapter', () => {
  it('is the Express middleware, which is what platform-express takes', async () => {
    // Nest's default platform *is* Express, so this must behave identically — including the
    // `originalUrl` reconstruction, which is the only reason the Express adapter is not a one-liner.
    const app = express();
    app.use(BASE_PATH, dashboard().nest());
    const res = await request(app, CONFIG_PATH);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});

describe('the raw-Node adapter', () => {
  it('answers true for a path it served and false for one it did not', async () => {
    const handled: boolean[] = [];
    const node = dashboard().node();
    const res = await callHandler((req, response) => {
      const served = node(req, response);
      handled.push(served);
      if (!served) response.end('fell-through');
    }, CONFIG_PATH);
    expect(handled).toEqual([true]);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const miss = await callHandler((req, response) => {
      const served = node(req, response);
      handled.push(served);
      if (!served) response.end('fell-through');
    }, '/elsewhere');
    expect(handled).toEqual([true, false]);
    expect(miss.body).toBe('fell-through');
  });
});

/** Drive an Express app in-process — `app` is itself a `(req, res)` handler. */
function request(
  app: (req: IncomingMessage, res: ServerResponse) => void,
  path: string,
): Promise<{ status: number; body: string }> {
  return callHandler(app, path);
}
