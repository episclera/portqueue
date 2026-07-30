import { json } from '../http';
import { jobsQuery, text, when } from '../params';
import { serializeJob, serializeJobPage } from '../serialize';
import type { Route } from './types';

/**
 * `GET /api/jobs` — a page of jobs, newest first, optionally narrowed by a free-text search.
 *
 * The search is a `LIKE` in the database, so it is a paged query like any other read rather than a
 * scan of the table through this process.
 */
export const jobsRoute: Route = {
  method: 'GET',
  path: '/api/jobs',
  summary: 'List jobs, with filters and free-text search',
  handle: async ({ portQueue, query }) => {
    const page = await portQueue._dashboard.getJobs({
      ...jobsQuery(query),
      ...when('search', text(query, 'search')),
    });
    return json(200, serializeJobPage(page));
  },
};

/**
 * `GET /api/jobs/:jobId` — one job by id, from the public API.
 *
 * A job id already identifies exactly one row, so this needs no queue and takes none.
 */
export const jobRoute: Route = {
  method: 'GET',
  path: /^\/api\/jobs\/([^/]+)$/,
  summary: 'One job by id',
  handle: async ({ portQueue, params }) => {
    const job = await portQueue.getJob({ jobId: params[0]! });
    if (!job) return json(404, { error: 'Job not found' });
    return json(200, serializeJob(job));
  },
};
