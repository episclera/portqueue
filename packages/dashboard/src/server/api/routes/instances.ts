import { json } from '../http';
import { paging, text, triBool, when } from '../params';
import { serializeInstance, serializeInstancePage } from '../serialize';
import type { Route } from './types';

/** `GET /api/instances` — a page of instances with liveness and per-instance job attribution. */
export const instancesRoute: Route = {
  method: 'GET',
  path: '/api/instances',
  summary: 'List instances with liveness and job attribution',
  handle: async ({ portQueue, query }) => {
    const page = await portQueue._dashboard.getInstances({
      ...paging(query),
      ...when('search', text(query, 'search')),
      ...when('processingPaused', triBool(query.get('processingPaused'))),
      ...when('alive', triBool(query.get('alive'))),
    });
    return json(200, serializeInstancePage(page));
  },
};

/** `GET /api/instances/:instanceKey` — the instance detail page's header. */
export const instanceRoute: Route = {
  method: 'GET',
  path: /^\/api\/instances\/([^/]+)$/,
  summary: 'One instance by key',
  handle: async ({ portQueue, params }) => {
    const instance = await portQueue._dashboard.getInstance({ instanceKey: params[0]! });
    if (!instance) return json(404, { error: 'Instance not found' });
    return json(200, serializeInstance(instance));
  },
};
