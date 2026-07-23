/**
 * `createDashboard(options)` — the single named-options factory. Builds the
 * framework-agnostic engine (see `engine.ts`) once, then exposes per-framework handlers, each
 * of which is a thin wrapper defined in `adapters/`. Uses the provided PortQueue instance only;
 * never opens a DB connection.
 */
import { createEngine } from './engine';
import { createExpressMiddleware } from './adapters/express';
import { createFastifyPlugin } from './adapters/fastify';
import { createKoaMiddleware } from './adapters/koa';
import { createNestMiddleware } from './adapters/nest';
import { createNodeHandler } from './adapters/node';
import type { Dashboard, DashboardOptions } from './types';

export function createDashboard(options: DashboardOptions): Dashboard {
  const engine = createEngine(options);
  return {
    basePath: engine.basePath,
    node: () => createNodeHandler(engine),
    express: () => createExpressMiddleware(engine),
    koa: () => createKoaMiddleware(engine),
    fastify: () => createFastifyPlugin(engine),
    nest: () => createNestMiddleware(engine),
  };
}
