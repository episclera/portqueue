/**
 * The framework-agnostic serve core (extracted from `create-dashboard`). Holds the router,
 * config, and path matching, and exposes `serve`/`serveSafely` that every adapter drives with
 * a raw Node `(req, res)` pair. Uses the provided PortQueue instance only; never opens a DB
 * connection.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { authorize } from './api/auth';
import { createRouter, subscribeEvents, type HandlerInput } from './api/routes';
import { serveAsset } from './assets';
import { normalizeBase, readBody, toHeaders } from './request';
import type { DashboardOptions } from './types';
import type { DashboardConfigDto } from '../shared/dto';

const SSE_KEEP_ALIVE_MS = 25000;

export interface DashboardEngine {
  /** The resolved, normalized mount path. */
  readonly basePath: string;
  /** True when the URL falls under our mount. */
  owns(url: string | undefined): boolean;
  /** The core async serve routine — writes directly to the raw response. */
  serve(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** `serve` wrapped so any error becomes a 500 instead of an unhandled rejection. */
  serveSafely(req: IncomingMessage, res: ServerResponse): void;
}

export function createEngine(options: DashboardOptions): DashboardEngine {
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

  function owns(url: string | undefined): boolean {
    if (!url) return false;
    const path = url.split('?')[0] ?? '';
    return path === basePath || path.startsWith(`${basePath}/`) || path.startsWith(`${basePath}?`);
  }

  function relPath(url: string): string {
    const path = (url.split('?')[0] ?? '').slice(basePath.length);
    return path.startsWith('/') || path === '' ? path || '/' : `/${path}`;
  }

  function denyUnauthorized(res: ServerResponse, challenge: string | undefined): void {
    res.writeHead(401, challenge ? { 'www-authenticate': challenge } : {});
    res.end('Unauthorized');
  }

  /** Handle the SSE stream on a raw Node response. */
  async function handleEvents(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const decision = await authorize(options.auth, {
      method: req.method ?? 'GET',
      url: req.url ?? '',
      headers: toHeaders(req),
    });
    if (!decision.authorized) return denyUnauthorized(res, decision.challenge);

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
    }, SSE_KEEP_ALIVE_MS);
    const cleanup = (): void => {
      clearInterval(keepAlive);
      unsubscribe();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  /** Handle a JSON API request (reads + auth-gated mutations). */
  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    url: string,
  ): Promise<void> {
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
  }

  /** Serve the static SPA shell / assets (auth-gated). */
  async function handleAsset(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    url: string,
  ): Promise<void> {
    const decision = await authorize(options.auth, { method, url, headers: toHeaders(req) });
    if (!decision.authorized) return denyUnauthorized(res, decision.challenge);
    const asset = await serveAsset(relPath(url), config);
    res.writeHead(asset.status, { 'content-type': asset.contentType });
    res.end(asset.body);
  }

  async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '';
    const method = (req.method ?? 'GET').toUpperCase();

    if (router.isEventsPath(url) && method === 'GET') return handleEvents(req, res);
    if (router.isApiPath(url)) return handleApi(req, res, method, url);
    return handleAsset(req, res, method, url);
  }

  function serveSafely(req: IncomingMessage, res: ServerResponse): void {
    void serve(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal dashboard error' }));
    });
  }

  return { basePath, owns, serve, serveSafely };
}
