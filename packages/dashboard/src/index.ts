/**
 * `@portqueue/dashboard` public API. The `createDashboard` factory plus its
 * option, handler, and auth types. The client SPA is a build artifact served by the middleware;
 * only the server surface is exported here.
 */
export { createDashboard } from './server/create-dashboard.js';
export type {
  Dashboard,
  DashboardOptions,
  NodeHandler,
  ExpressMiddleware,
  KoaMiddleware,
  FastifyPlugin,
  NestMiddleware,
  KoaContext,
  FastifyLike,
} from './server/types.js';
export type { DashboardAuth, AuthRequest, AuthResult, AuthDecision } from './server/api/auth.js';

// Framework adapters (ergonomic named imports; equivalent to the methods on Dashboard).
export { expressAdapter } from './server/adapters/express.js';
export { koaAdapter } from './server/adapters/koa.js';
export { fastifyAdapter } from './server/adapters/fastify.js';
export { nestAdapter } from './server/adapters/nest.js';
export { nodeAdapter } from './server/adapters/node.js';

// Wire DTO types, shared with any external consumer of the JSON API.
export type * from './shared/dto.js';
