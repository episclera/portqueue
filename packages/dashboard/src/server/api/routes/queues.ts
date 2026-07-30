import { json } from '../http';
import { paging, text, triBool, when } from '../params';
import { serializeQueuePage } from '../serialize';
import type { Route } from './types';

/**
 * `GET /api/queues` — a page of queues with their per-status counts.
 *
 * Filtering and paging both happen in the database; the counts arrive from one grouped query over
 * this page's names. There is no `inUse` filter: that flag means "declared in the process that
 * produced this row", and the dashboard runs on its own client, so it cannot know.
 */
export const queuesRoute: Route = {
  method: 'GET',
  path: '/api/queues',
  summary: 'List queues with their per-status counts',
  handle: async ({ portQueue, query }) => {
    const page = await portQueue._dashboard.getQueues({
      ...paging(query),
      ...when('search', text(query, 'search')),
      ...when('processingPaused', triBool(query.get('processingPaused'))),
    });
    return json(200, serializeQueuePage(page));
  },
};
