/**
 * `@portqueue/dashboard` public API (build_plan/12.3). The `createDashboard` factory plus its
 * option and auth types. The client SPA is a build artifact served by the middleware; only the
 * server surface is exported here.
 */
export { createDashboard } from './server/create-dashboard.js';
export type {
  Dashboard,
  DashboardOptions,
  NodeHandler,
  KoaContext,
  FastifyLike,
} from './server/create-dashboard.js';
export type { DashboardAuth, AuthRequest, AuthResult, AuthDecision } from './server/api/auth.js';

// Framework adapters (ergonomic named imports; equivalent to the methods on Dashboard).
export { expressAdapter } from './server/adapters/express.js';
export { koaAdapter } from './server/adapters/koa.js';
export { fastifyAdapter } from './server/adapters/fastify.js';
export { nodeAdapter } from './server/adapters/node.js';

// Wire DTO types, shared with any external consumer of the JSON API.
export type * from './shared/dto.js';
