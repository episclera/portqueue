/**
 * Koa adapter (build_plan/12.2). Thin wrapper returning the koa middleware.
 * `app.use(koaAdapter(dashboard))`.
 */
import type { Dashboard } from '../create-dashboard.js';

export function koaAdapter(dashboard: Dashboard): ReturnType<Dashboard['koa']> {
  return dashboard.koa();
}
