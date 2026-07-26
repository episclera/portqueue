/**
 * `@portqueue/dashboard` public API. The `createDashboard` factory plus its option and handler
 * types. The client SPA is a build artifact served by the middleware; only the server surface is
 * exported here.
 *
 * The dashboard ships **no authentication**. Anyone who can reach the mount can perform every
 * action it offers, so put it behind whatever auth middleware your app already uses — see the
 * "Protecting the dashboard" section of the docs.
 */
export { createDashboard } from './server/create-dashboard';
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
} from './server/types';

// Framework adapters (ergonomic named imports; equivalent to the methods on Dashboard).
export { expressAdapter } from './server/adapters/express';
export { koaAdapter } from './server/adapters/koa';
export { fastifyAdapter } from './server/adapters/fastify';
export { nestAdapter } from './server/adapters/nest';
export { nodeAdapter } from './server/adapters/node';

// Wire DTO types, shared with any external consumer of the JSON API.
export type * from './shared/dto';
export { ActionKind } from './shared/dto';
