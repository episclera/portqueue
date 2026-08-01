/**
 * Fastify adapter. `app.register(fastifyAdapter(dashboard))` or
 * `app.register(dashboard.fastify())`.
 *
 * **The plugin opts out of Fastify's encapsulation, and it has to.** `register` normally gives a
 * plugin its own child context, and a hook added inside one only runs for routes registered in that
 * context — of which the dashboard has none, because it serves the raw request itself rather than
 * declaring Fastify routes. So the hook never fired and every dashboard URL fell through to
 * Fastify's own 404. Setting `skip-override` (what `fastify-plugin` does, without the dependency)
 * makes `addHook` apply to the instance the host registered it on.
 */
import type { DashboardEngine } from '../engine';
import type { Dashboard, FastifyPlugin } from '../types';

/** Fastify's marker for "run me on the parent instance, not a child context". */
const SKIP_OVERRIDE = Symbol.for('skip-override');

export function createFastifyPlugin(engine: DashboardEngine): FastifyPlugin {
  const plugin: FastifyPlugin = (fastify, _opts, done) => {
    // `async`, so Fastify sees a promise from a two-parameter hook rather than guessing whether the
    // hook is done — a bare `undefined` return leaves the request waiting for a `done` it never gets.
    fastify.addHook('onRequest', async (request, reply) => {
      if (!engine.owns(request.raw.url)) return;
      // Fastify owns the reply until this call; without it Fastify would answer too, and the second
      // write to the same response throws.
      reply.hijack();
      engine.serveSafely(request.raw, reply.raw);
    });
    done();
  };
  (plugin as unknown as Record<symbol, boolean>)[SKIP_OVERRIDE] = true;
  return plugin;
}

/** Ergonomic named-import wrapper, equivalent to `dashboard.fastify()`. */
export function fastifyAdapter(dashboard: Dashboard): FastifyPlugin {
  return dashboard.fastify();
}
