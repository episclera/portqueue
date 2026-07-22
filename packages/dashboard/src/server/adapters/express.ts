/**
 * Express adapter (build_plan/12.2). Thin wrapper: given a Dashboard, return the express
 * middleware. `app.use(basePath, expressAdapter(dashboard))`.
 */
import type { Dashboard } from '../create-dashboard.js';

export function expressAdapter(dashboard: Dashboard): ReturnType<Dashboard['express']> {
  return dashboard.express();
}
