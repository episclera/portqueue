/**
 * Koa adapter. `app.use(koaAdapter(dashboard))` or
 * `app.use(dashboard.koa())`.
 */
import type { DashboardEngine } from '../engine';
import type { Dashboard, KoaMiddleware } from '../types';

export function createKoaMiddleware(engine: DashboardEngine): KoaMiddleware {
  return async (ctx, next) => {
    if (!engine.owns(ctx.req.url)) {
      await next();
      return;
    }
    ctx.respond = false; // we write to the raw response directly
    await engine.serve(ctx.req, ctx.res);
  };
}

/** Ergonomic named-import wrapper, equivalent to `dashboard.koa()`. */
export function koaAdapter(dashboard: Dashboard): KoaMiddleware {
  return dashboard.koa();
}
