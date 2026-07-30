/**
 * `createDashboard(options)` — the single named-options factory. Builds the framework-agnostic
 * engine (see `engine.ts`) once, then exposes per-framework handlers, each a thin wrapper defined in
 * `adapters/`.
 *
 * It takes a **driver** and builds its own headless client from it (see `client.ts`), rather than
 * riding on the application's `PortQueue`. Mounting opens no connection; the first API request does,
 * and `close()` releases it.
 */
import { createEngine } from './engine';
import { createExpressMiddleware } from './adapters/express';
import { createFastifyPlugin } from './adapters/fastify';
import { createKoaMiddleware } from './adapters/koa';
import { createNestMiddleware } from './adapters/nest';
import { createNodeHandler } from './adapters/node';
import type { DashboardClient } from './client';
import type { Dashboard, DashboardOptions } from './types';

export function createDashboard(
  /**
   * `client` is an internal seam: it lets a test drive the router without a database and is never
   * part of the documented option surface. Production always passes `driver` alone.
   */
  options: DashboardOptions & { client?: DashboardClient },
): Dashboard {
  const engine = createEngine(options);
  return {
    basePath: engine.basePath,
    node: () => createNodeHandler(engine),
    express: () => createExpressMiddleware(engine),
    koa: () => createKoaMiddleware(engine),
    fastify: () => createFastifyPlugin(engine),
    nest: () => createNestMiddleware(engine),
    close: () => engine.close(),
  };
}
