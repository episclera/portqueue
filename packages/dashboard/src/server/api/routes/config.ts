import { json } from '../http';
import type { Route } from './types';

/**
 * `GET /api/config` — a liveness probe with no payload of its own.
 *
 * It exists so a client can confirm it is talking to a PortQueue dashboard at all, which is a
 * different question from whether any particular page has data. Deliberately carries no
 * configuration: anything the SPA needs to render is baked into the shell it was served.
 */
export const configRoute: Route = {
  method: 'GET',
  path: '/api/config',
  summary: 'Confirm the mount is a PortQueue dashboard',
  handle: async () => json(200, { ok: true }),
};
