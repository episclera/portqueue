/**
 * Fastify adapter (build_plan/12.2). Thin wrapper returning the fastify plugin.
 * `app.register(fastifyAdapter(dashboard))`.
 */
import type { Dashboard } from '../create-dashboard.js';

export function fastifyAdapter(dashboard: Dashboard): ReturnType<Dashboard['fastify']> {
  return dashboard.fastify();
}
