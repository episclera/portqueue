/**
 * NestJS adapter. Nest's default platform is Express, so the dashboard mounts
 * as ordinary functional middleware — no `@nestjs/*` dependency is required. Wire it in a module:
 *
 * ```ts
 * @Module({})
 * export class DashboardModule implements NestModule {
 *   constructor(private readonly dashboard: Dashboard) {}
 *   configure(consumer: MiddlewareConsumer): void {
 *     consumer.apply(nestAdapter(this.dashboard)).forRoutes('/portqueue');
 *   }
 * }
 * ```
 *
 * The middleware reconstructs the full mount path from `req.originalUrl`, exactly like the
 * Express adapter, so it behaves identically under `@nestjs/platform-express`.
 */
import type { DashboardEngine } from '../engine.js';
import type { Dashboard, NestMiddleware } from '../types.js';
import { createExpressMiddleware } from './express.js';

export function createNestMiddleware(engine: DashboardEngine): NestMiddleware {
  // Nest (platform-express) middleware is Express middleware.
  return createExpressMiddleware(engine);
}

/** Ergonomic named-import wrapper, equivalent to `dashboard.nest()`. */
export function nestAdapter(dashboard: Dashboard): NestMiddleware {
  return dashboard.nest();
}
