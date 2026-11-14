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
    // A body parser above us (`koa-bodyparser`, `@koa/bodyparser`) drained the raw stream and left
    // the result on `ctx.request`; hand it to the reader, which looks for it on the raw request.
    const parsed = (ctx as { request?: { body?: unknown } }).request?.body;
    const raw = ctx.req as typeof ctx.req & { body?: unknown };
    if (parsed !== undefined && raw.body === undefined) raw.body = parsed;
    await engine.serve(ctx.req, ctx.res);
  };
}

/** Ergonomic named-import wrapper, equivalent to `dashboard.koa()`. */
export function koaAdapter(dashboard: Dashboard): KoaMiddleware {
  return dashboard.koa();
}
