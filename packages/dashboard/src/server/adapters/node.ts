/**
 * Raw-Node adapter (build_plan/12.2). Thin wrapper returning the `(req, res) => boolean`
 * handler. Call it in your own request handler; it returns true when it served the request.
 */
import type { Dashboard, NodeHandler } from '../create-dashboard.js';

export function nodeAdapter(dashboard: Dashboard): NodeHandler {
  return dashboard.node();
}
