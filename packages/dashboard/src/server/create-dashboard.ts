/**
 * `createDashboard(options)` (build_plan/12.3) — the single named-options factory. Builds the
 * framework-agnostic engine (see `engine.ts`) once, then exposes per-framework handlers, each
 * of which is a thin wrapper defined in `adapters/`. Uses the provided PortQueue instance only;
 * never opens a DB connection.
 */
import { createEngine } from './engine.js';
import { createExpressMiddleware } from './adapters/express.js';
import { createFastifyPlugin } from './adapters/fastify.js';
import { createKoaMiddleware } from './adapters/koa.js';
import { createNestMiddleware } from './adapters/nest.js';
import { createNodeHandler } from './adapters/node.js';
import type { Dashboard, DashboardOptions } from './types.js';

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
