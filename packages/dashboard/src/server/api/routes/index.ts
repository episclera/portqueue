/**
 * The route registry and the router built from it.
 *
 * Reads are dispatched by path against {@link ROUTES}; mutations arrive as one `POST /api/actions`
 * and are dispatched by {@link ActionKind} against `ACTIONS_BY_KIND`. Both are plain lists of
 * self-describing objects, so the whole API surface is readable in one place and adding to it never
 * means extending a conditional chain.
 *
 * There is **no authentication and no read-only mode anywhere in here**: protecting the mount belongs
 * to whatever middleware the host puts in front of it (see `docs/docs/dashboard.mdx`). Anyone who can
 * reach these routes can perform every action.
 */
import { json, queryOf, relativePath, type HandlerInput, type HandlerResult } from '../http';
import { ACTIONS, ACTIONS_BY_KIND } from './actions';
import { configRoute } from './config';
import { instanceRoute, instancesRoute } from './instances';
import { jobRoute, jobsRoute } from './jobs';
import { queuesRoute } from './queues';
import { scheduleRoute, schedulesRoute } from './schedules';
import { statsRoute } from './stats';
import type { PortQueue } from '@portqueue/core';
import type { DashboardClient } from '../../client';
import type { ActionRequestDto } from '../../../shared/dto';
import type { Route } from './types';

export type { HandlerInput, HandlerResult } from '../http';
export type { Route, RouteContext } from './types';
export type { ActionContext, ActionRoute } from './actions';
export { ACTIONS, ACTIONS_BY_KIND };

/** The path every mutation posts to. */
const ACTIONS_PATH = '/api/actions';

/**
 * Every read route. Literal paths are matched before patterns, so `/api/jobs` can sit beside
 * `/api/jobs/:id` without their order here mattering.
 */
export const ROUTES: readonly Route[] = [
  configRoute,
  queuesRoute,
  jobsRoute,
  jobRoute,
  schedulesRoute,
  scheduleRoute,
  instancesRoute,
  instanceRoute,
  statsRoute,
];

export interface RouterOptions {
  /** Resolves (and, on the first call, connects) the dashboard's own headless client. */
  client: DashboardClient;
  basePath: string;
}

/**
 * Create the router. Returns the pure JSON handler plus the path predicate the adapters use to
 * decide between an API call and a static asset.
 */
export function createRouter(options: RouterOptions): {
  handle: (input: HandlerInput) => Promise<HandlerResult>;
  isApiPath: (url: string) => boolean;
} {
  const { client, basePath } = options;

  const isApiPath = (url: string): boolean => relativePath(url, basePath).startsWith('/api/');

  async function handle(input: HandlerInput): Promise<HandlerResult> {
    const path = relativePath(input.url, basePath);
    const method = input.method.toUpperCase();

    // Resolved per request: the first one connects, and a failure here is a 503 the client can retry
    // rather than a mount-time crash the host can do nothing about.
    let portQueue: PortQueue;
    try {
      portQueue = await client.get();
    } catch (err) {
      return json(503, {
        error: err instanceof Error ? err.message : 'Cannot reach the PortQueue database',
      });
    }

    if (method === 'POST' && path === ACTIONS_PATH) return handleAction(portQueue, input.body);
    if (method === 'GET') return handleRead(portQueue, path, queryOf(input.url));
    return json(404, { error: 'Not found' });
  }

  return { handle, isApiPath };
}

/** Dispatch a read to the first route whose `path` matches. */
async function handleRead(
  portQueue: PortQueue,
  path: string,
  query: URLSearchParams,
): Promise<HandlerResult> {
  for (const route of ROUTES) {
    const params = match(route, path);
    if (params) return route.handle({ portQueue, query, params });
  }
  return json(404, { error: 'Not found' });
}

/** The captured, decoded segments when `route` matches `path`, or `null` when it doesn't. */
function match(route: Route, path: string): string[] | null {
  if (typeof route.path === 'string') return route.path === path ? [] : null;
  const found = route.path.exec(path);
  if (!found) return null;
  return found.slice(1).map((segment) => decodeURIComponent(segment));
}

/** Parse a mutation body and hand it to the action that owns its `kind`. */
async function handleAction(
  portQueue: PortQueue,
  body: string | undefined,
): Promise<HandlerResult> {
  let action: ActionRequestDto;
  try {
    action = JSON.parse(body ?? '') as ActionRequestDto;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  const route = action && ACTIONS_BY_KIND.get(action.kind);
  if (!route) return json(400, { error: 'Unknown action' });
  return route.handle({ portQueue, action });
}
