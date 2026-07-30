import { json } from '../http';
import { text, when } from '../params';
import { serializeStats } from '../serialize';
import type { Route } from './types';

/**
 * `GET /api/stats` — per-status counts for one queue, or client-wide when `queue` is omitted.
 *
 * Counts only. The dashboard renders activity cards and nothing else, so there is deliberately no
 * throughput or failure-rate derivation here to disagree with the numbers on the tables.
 */
export const statsRoute: Route = {
  method: 'GET',
  path: '/api/stats',
  summary: 'Per-status counts, for one queue or the whole client',
  handle: async ({ portQueue, query }) => {
    const stats = await portQueue._dashboard.getStats({ ...when('queue', text(query, 'queue')) });
    return json(200, serializeStats(stats));
  },
};
