/**
 * Fastify adapter. `app.register(fastifyAdapter(dashboard))` or
 * `app.register(dashboard.fastify())`.
 */
import type { DashboardEngine } from '../engine.js';
import type { Dashboard, FastifyPlugin } from '../types.js';

export function createFastifyPlugin(engine: DashboardEngine): FastifyPlugin {
  return (fastify, _opts, done) => {
    fastify.addHook('onRequest', (request, reply) => {
      if (!engine.owns(request.raw.url)) return;
      reply.hijack();
      engine.serveSafely(request.raw, reply.raw);
    });
    done();
  };
}

/** Ergonomic named-import wrapper, equivalent to `dashboard.fastify()`. */
export function fastifyAdapter(dashboard: Dashboard): FastifyPlugin {
  return dashboard.fastify();
}
