/**
 * `createDashboard(options)` (build_plan/12.3) — the single named-options factory. Returns
 * per-framework handlers. Uses the provided PortQueue instance only; never opens a DB
 * connection. The node handler is the core; the express/koa/fastify adapters are thin wrappers.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PortQueue } from '@portqueue/core';
import { createRouter, subscribeEvents, type HandlerInput } from './api/routes.js';
import { serveAsset } from './assets.js';
import type { DashboardAuth } from './api/auth.js';
import { authorize } from './api/auth.js';
import type { DashboardConfigDto } from '../shared/dto.js';

export type { DashboardAuth, AuthRequest, AuthResult } from './api/auth.js';

export interface DashboardOptions {
  /** The developer's running PortQueue instance. The dashboard rides on it. */
  portQueue: PortQueue;
  /** Mount path (default `/portqueue`). */
  basePath?: string;
  /** Pluggable auth guard (default: none). */
  auth?: DashboardAuth;
  /** Disable all mutating actions server-side. */
  readOnly?: boolean;
  /** Header/title text. */
  title?: string;
  /** Initial theme preference for the SPA. */
  theme?: 'light' | 'dark' | 'system';
}

/** A raw-Node request handler: returns true if it handled the request. */
export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => boolean;

export interface Dashboard {
  /** Raw Node: call in your handler; returns true when it served the request. */
  node: () => NodeHandler;
  /** Express middleware `(req, res, next) => void`. */
  express: () => (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  /** Koa middleware `(ctx, next) => Promise<void>`. */
  koa: () => (ctx: KoaContext, next: () => Promise<void>) => Promise<void>;
  /** Fastify plugin `(fastify, opts, done) => void`. */
  fastify: () => (fastify: FastifyLike, opts: unknown, done: () => void) => void;
  /** The resolved base path. */
  basePath: string;
}

/** Minimal structural Koa context (avoid a hard koa dependency). */
export interface KoaContext {
  req: IncomingMessage;
  res: ServerResponse;
  respond?: boolean;
}

/** Minimal structural Fastify instance. */
export interface FastifyLike {
  addHook: (
    name: 'onRequest',
    fn: (req: { raw: IncomingMessage }, reply: { raw: ServerResponse; hijack: () => void }) => void,
  ) => void;
}

function normalizeBase(basePath: string): string {
  let b = basePath.trim();
  if (!b.startsWith('/')) b = `/${b}`;
  if (b.length > 1 && b.endsWith('/')) b = b.slice(0, -1);
  return b;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX = 1024 * 1024; // 1MB guard
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function toHeaders(req: IncomingMessage): Record<string, string | string[] | undefined> {
  return req.headers as Record<string, string | string[] | undefined>;
}

export function createDashboard(options: DashboardOptions): Dashboard {
  const basePath = normalizeBase(options.basePath ?? '/portqueue');
  const readOnly = options.readOnly ?? false;
  const config: DashboardConfigDto = {
    basePath,
    title: options.title ?? 'PortQueue Dashboard',
    theme: options.theme ?? 'system',
    readOnly,
  };
  const router = createRouter({
    portQueue: options.portQueue,
    basePath,
    ...(options.auth ? { auth: options.auth } : {}),
    readOnly,
  });

  /** True when the URL falls under our mount. */
  function owns(url: string | undefined): boolean {
    if (!url) return false;
    const path = url.split('?')[0] ?? '';
    return path === basePath || path.startsWith(`${basePath}/`) || path.startsWith(`${basePath}?`);
  }

  function relPath(url: string): string {
    const path = (url.split('?')[0] ?? '').slice(basePath.length);
    return path.startsWith('/') || path === '' ? path || '/' : `/${path}`;
  }

  /** Handle the SSE stream on a raw Node response. */
  async function handleEvents(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const decision = await authorize(options.auth, {
      method: req.method ?? 'GET',
      url: req.url ?? '',
      headers: toHeaders(req),
    });
    if (!decision.authorized) {
      res.writeHead(401, decision.challenge ? { 'www-authenticate': decision.challenge } : {});
      res.end('Unauthorized');
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`event: ready\ndata: {}\n\n`);
    const unsubscribe = subscribeEvents(options.portQueue, (line) => res.write(line));
    const keepAlive = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch {
        /* ignore */
      }
    }, 25000);
    const cleanup = (): void => {
      clearInterval(keepAlive);
      unsubscribe();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  /** The core async serve routine, shared by every adapter. */
  async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '';
    const method = (req.method ?? 'GET').toUpperCase();

    if (router.isEventsPath(url) && method === 'GET') {
      await handleEvents(req, res);
      return;
    }

    if (router.isApiPath(url)) {
      let body: string | undefined;
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        try {
          body = await readBody(req);
        } catch {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
          return;
        }
      }
      const input: HandlerInput = { method, url, body, headers: toHeaders(req) };
      const result = await router.handle(input);
      res.writeHead(result.status, result.headers);
      res.end(result.body);
      return;
    }

    // Static assets / SPA. Auth-gate the HTML shell too.
    const decision = await authorize(options.auth, { method, url, headers: toHeaders(req) });
    if (!decision.authorized) {
      res.writeHead(401, decision.challenge ? { 'www-authenticate': decision.challenge } : {});
      res.end('Unauthorized');
      return;
    }
    const asset = await serveAsset(relPath(url), config);
    res.writeHead(asset.status, { 'content-type': asset.contentType });
    res.end(asset.body);
  }

  const node: NodeHandler = (req, res) => {
    if (!owns(req.url)) return false;
    void serve(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal dashboard error' }));
    });
    return true;
  };

  return {
    basePath,
    node: () => node,
    express: () => (req, res, next) => {
      // Express strips the mount path from req.url; reconstruct so our router sees basePath.
      const original = req.url ?? '';
      const originalUrl = (req as unknown as { originalUrl?: string }).originalUrl;
      if (originalUrl) req.url = originalUrl;
      if (!owns(req.url)) {
        req.url = original;
        next();
        return;
      }
      void serve(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal dashboard error' }));
      });
    },
    koa: () => async (ctx, next) => {
      if (!owns(ctx.req.url)) {
        await next();
        return;
      }
      ctx.respond = false; // we write to the raw response directly
      await serve(ctx.req, ctx.res);
    },
    fastify: () => (fastify, _opts, done) => {
      fastify.addHook('onRequest', (request, reply) => {
        if (!owns(request.raw.url)) return;
        reply.hijack();
        void serve(request.raw, reply.raw).catch(() => {
          if (!reply.raw.headersSent)
            reply.raw.writeHead(500, { 'content-type': 'application/json' });
          reply.raw.end(JSON.stringify({ error: 'Internal dashboard error' }));
        });
      });
      done();
    },
  };
}
