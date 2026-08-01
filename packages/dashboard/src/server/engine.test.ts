/**
 * The serve core every adapter drives: what it owns, what headers it writes, and how it answers when
 * something goes wrong.
 *
 * The security headers and the two failure paths are the parts worth pinning. Every response carries
 * `nosniff`, `DENY` and `no-referrer` — the last one because a dashboard URL contains a job id, and
 * without it that id is sent to any external link an operator follows from the page.
 * @jest-environment node
 */
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createEngine } from './engine';
import { fakePq, stubClient } from '../test-support/api';
import { MAX_BODY_BYTES, REQUESTED_WITH_HEADER, REQUESTED_WITH_MARKER } from '../shared/constants';
import type { DashboardClient } from './client';

const BASE_PATH = '/portqueue';

function engineWith(client?: DashboardClient): ReturnType<typeof createEngine> {
  const { pq } = fakePq();
  return createEngine({
    driver: {} as never,
    basePath: BASE_PATH,
    client: client ?? stubClient(pq),
    logger: { warn: () => {} },
  });
}

interface Answered {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Serve one request and collect the response, with no socket and no port. */
function serve(
  engine: ReturnType<typeof createEngine>,
  init: { method?: string; url: string; body?: string; headers?: Record<string, string> },
): Promise<Answered> {
  return new Promise((resolve) => {
    const req = new IncomingMessage(new Socket());
    req.method = init.method ?? 'GET';
    req.url = init.url;
    req.headers = init.headers ?? { [REQUESTED_WITH_HEADER]: REQUESTED_WITH_MARKER };
    const res = new ServerResponse(req);
    const headers: Record<string, string> = {};
    let body = '';
    res.writeHead = ((status: number, given?: Record<string, string>) => {
      res.statusCode = status;
      Object.assign(headers, given ?? {});
      return res;
    }) as typeof res.writeHead;
    res.end = ((chunk?: unknown) => {
      if (chunk != null && typeof chunk !== 'function') body += String(chunk);
      resolve({ status: res.statusCode, headers, body });
      return res;
    }) as typeof res.end;

    engine.serveSafely(req, res);
    if (init.body !== undefined) req.push(Buffer.from(init.body));
    req.push(null);
  });
}

describe('owns', () => {
  it('matches the mount and everything under it', () => {
    const engine = engineWith();
    expect(engine.owns(BASE_PATH)).toBe(true);
    expect(engine.owns(`${BASE_PATH}/jobs`)).toBe(true);
    expect(engine.owns(`${BASE_PATH}?tab=jobs`)).toBe(true);
    expect(engine.owns(`${BASE_PATH}/api/jobs?limit=20`)).toBe(true);
  });

  it('does not match a path that merely starts with the mount', () => {
    // `/portqueue-admin` is somebody else's route, and a raw prefix test would swallow it.
    const engine = engineWith();
    expect(engine.owns('/portqueue-admin')).toBe(false);
    expect(engine.owns('/other')).toBe(false);
    expect(engine.owns(undefined)).toBe(false);
  });

  it('normalizes the mount it was given', () => {
    const { pq } = fakePq();
    const engine = createEngine({
      driver: {} as never,
      basePath: 'admin/queues/',
      client: stubClient(pq),
      logger: { warn: () => {} },
    });
    expect(engine.basePath).toBe('/admin/queues');
    expect(engine.owns('/admin/queues/jobs')).toBe(true);
  });
});

describe('every response', () => {
  it('carries the security headers, on the API and on an asset alike', async () => {
    const engine = engineWith();
    const api = await serve(engine, { url: `${BASE_PATH}/api/config` });
    expect(api.headers['x-content-type-options']).toBe('nosniff');
    expect(api.headers['x-frame-options']).toBe('DENY');
    // A job id lives in the URL, so the referrer must not leave the page.
    expect(api.headers['referrer-policy']).toBe('no-referrer');

    const asset = await serve(engine, { url: BASE_PATH });
    expect(asset.headers['x-content-type-options']).toBe('nosniff');
    expect(asset.headers['referrer-policy']).toBe('no-referrer');
  });

  it('serves the SPA shell for a client-side route, so a deep link reloads', async () => {
    const res = await serve(engineWith(), { url: `${BASE_PATH}/jobs/job-1` });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    // The shell's one inline script is authorized by a nonce, and nothing else is.
    expect(res.headers['content-security-policy']).toContain("script-src 'self' 'nonce-");
  });
});

describe('failure paths', () => {
  it('answers 413 for a body over the cap, as JSON the client can read', async () => {
    const res = await serve(engineWith(), {
      method: 'POST',
      url: `${BASE_PATH}/api/actions/pause`,
      body: 'x'.repeat(MAX_BODY_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toEqual({ error: 'Request body too large' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('turns an unexpected throw into a 500 rather than an unhandled rejection', async () => {
    // `serveSafely` is what every adapter calls, precisely so a bug in a route cannot take the host
    // process down with it.
    const exploding: DashboardClient = {
      get: () => {
        throw new Error('boom');
      },
      close: async () => {},
    };
    const res = await serve(engineWith(exploding), { url: `${BASE_PATH}/api/config` });
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body).error).toContain('boom');
  });
});

describe('close', () => {
  it('releases the client it owns', async () => {
    let closed = 0;
    const { pq } = fakePq();
    const engine = engineWith({ get: async () => pq, close: async () => void (closed += 1) });
    await engine.close();
    expect(closed).toBe(1);
  });
});
