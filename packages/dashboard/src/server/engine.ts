/**
 * The framework-agnostic serve core. Holds the router, config and path matching, and exposes
 * `serve`/`serveSafely` that every adapter drives with a raw Node `(req, res)` pair.
 *
 * It owns the dashboard's own headless client (see `client.ts`), built from the driver it was given.
 * Nothing connects at mount: the first API request opens the connection, and `close()` releases it.
 *
 * The dashboard has no authentication of its own — see `api/routes.ts` and the dashboard docs.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRouter, type HandlerInput } from './api/routes';
import { hasBuiltClient, serveAsset } from './assets';
import { normalizeBase, readBody, toHeaders } from './request';
import { createDashboardClient, type DashboardClient } from './client';
import type { DashboardOptions } from './types';
import type { DashboardConfigDto } from '../shared/dto';

/**
 * Headers on every response the dashboard writes. `nosniff` stops a browser second-guessing a
 * declared content type; the rest keep the UI out of frames and stop the referrer leaking a job
 * id (which URLs carry) to any external link a user follows.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};

export interface DashboardEngine {
  /** The resolved, normalized mount path. */
  readonly basePath: string;
  /** True when the URL falls under our mount. */
  owns(url: string | undefined): boolean;
  /** The core async serve routine — writes directly to the raw response. */
  serve(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** `serve` wrapped so any error becomes a 500 instead of an unhandled rejection. */
  serveSafely(req: IncomingMessage, res: ServerResponse): void;
  /** Release the dashboard's own client. */
  close(): Promise<void>;
}

export function createEngine(
  options: DashboardOptions & { client?: DashboardClient },
): DashboardEngine {
  const basePath = normalizeBase(options.basePath ?? '/portqueue');
  const config: DashboardConfigDto = { basePath };
  const logger = options.logger ?? console;
  // The client is injectable so a test can drive the router without a driver; production always
  // builds it from the driver the host supplied.
  const client =
    options.client ??
    createDashboardClient({ driver: options.driver, ...(options.logger ? { logger } : {}) });
  const router = createRouter({ client, basePath });

  // A missing bundle makes every navigation serve the "not built" shell with a 200, which reads
  // as a working deploy. Say so once, at mount time, rather than letting it pass silently.
  void hasBuiltClient().then((built) => {
    if (!built) {
      logger.warn(
        `[@portqueue/dashboard] No client bundle found; serving the fallback shell at ${basePath}. ` +
          'The package was published or built without its SPA — run `npm run build` in ' +
          '@portqueue/dashboard, or reinstall the package.',
      );
    }
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

  /** Handle a JSON API request. */
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
        res.writeHead(413, { ...SECURITY_HEADERS, 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
    }
    const input: HandlerInput = { method, url, body, headers: toHeaders(req) };
    const result = await router.handle(input);
    res.writeHead(result.status, { ...SECURITY_HEADERS, ...result.headers });
    res.end(result.body);
  }

  /** Serve the static SPA shell / assets. */
  async function handleAsset(res: ServerResponse, url: string): Promise<void> {
    const asset = await serveAsset(relPath(url), config);
    res.writeHead(asset.status, {
      ...SECURITY_HEADERS,
      'content-type': asset.contentType,
      ...asset.headers,
    });
    res.end(asset.body);
  }

  async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '';
    const method = (req.method ?? 'GET').toUpperCase();
    if (router.isApiPath(url)) return handleApi(req, res, method, url);
    return handleAsset(res, url);
  }

  function serveSafely(req: IncomingMessage, res: ServerResponse): void {
    void serve(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Internal dashboard error' }));
    });
  }

  return { basePath, owns, serve, serveSafely, close: () => client.close() };
}
