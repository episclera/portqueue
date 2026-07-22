/**
 * Raw-Node adapter (build_plan/12.2). The `(req, res) => boolean` handler: returns true when
 * it served the request, so you can fall through to your own routing otherwise.
 */
import type { DashboardEngine } from '../engine.js';
import type { Dashboard, NodeHandler } from '../types.js';

export function createNodeHandler(engine: DashboardEngine): NodeHandler {
  return (req, res) => {
    if (!engine.owns(req.url)) return false;
    engine.serveSafely(req, res);
    return true;
  };
}

/** Ergonomic named-import wrapper, equivalent to `dashboard.node()`. */
export function nodeAdapter(dashboard: Dashboard): NodeHandler {
  return dashboard.node();
}
