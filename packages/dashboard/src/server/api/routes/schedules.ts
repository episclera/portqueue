import { json } from '../http';
import { paging, text, triBool, when } from '../params';
import { serializeSchedule, serializeSchedulePage } from '../serialize';
import type { Route } from './types';

/** `GET /api/schedules` — a page of schedules, across every queue unless `queue` narrows it. */
export const schedulesRoute: Route = {
  method: 'GET',
  path: '/api/schedules',
  summary: 'List recurring schedules',
  handle: async ({ portQueue, query }) => {
    const page = await portQueue._dashboard.getSchedules({
      ...paging(query),
      ...when('queue', text(query, 'queue')),
      ...when('search', text(query, 'search')),
      ...when('enabled', triBool(query.get('enabled'))),
    });
    return json(200, serializeSchedulePage(page));
  },
};

/** `GET /api/schedules/:scheduleId` — the schedule detail page's header. */
export const scheduleRoute: Route = {
  method: 'GET',
  path: /^\/api\/schedules\/([^/]+)$/,
  summary: 'One schedule by id',
  handle: async ({ portQueue, params }) => {
    const schedule = await portQueue._dashboard.getSchedule({ scheduleId: params[0]! });
    if (!schedule) return json(404, { error: 'Schedule not found' });
    return json(200, serializeSchedule(schedule));
  },
};
