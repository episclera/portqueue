/**
 * Express adapter. `app.use(basePath, expressAdapter(dashboard))` or
 * `app.use(dashboard.express())`.
 */
import type { DashboardEngine } from '../engine';
import type { Dashboard, ExpressMiddleware } from '../types';

export function createExpressMiddleware(engine: DashboardEngine): ExpressMiddleware {
  return (req, res, next) => {
    // Express strips the mount path from req.url; reconstruct so our router sees basePath.
    const original = req.url ?? '';
    const originalUrl = (req as unknown as { originalUrl?: string }).originalUrl;
    if (originalUrl) req.url = originalUrl;
    if (!engine.owns(req.url)) {
      req.url = original;
      next();
      return;
    }
    engine.serveSafely(req, res);
  };
}

/** Ergonomic named-import wrapper, equivalent to `dashboard.express()`. */
export function expressAdapter(dashboard: Dashboard): ExpressMiddleware {
  return dashboard.express();
}
