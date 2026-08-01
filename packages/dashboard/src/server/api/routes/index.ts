/**
 * The route registry and the router built from it.
 *
 * Reads are dispatched by path against {@link ROUTES}. Mutations are too: each one owns
 * `POST /api/actions/<kind>` and is dispatched against `ACTIONS_BY_KIND` by that path segment, so a
 * request names exactly one operation. Both registries are plain lists of self-describing objects,
 * so the whole API surface is readable in one place and adding to it never means extending a
 * conditional chain.
 *
 * The one guard that lives here is the CSRF check: a mutation must carry
 * {@link REQUESTED_WITH_HEADER}. See that constant for why a custom header is the defence, and
 * {@link assertSameOrigin} for what it refuses.
 *
 * There is otherwise **no authentication and no read-only mode anywhere in here**: protecting the
 * mount belongs to whatever middleware the host puts in front of it (see `docs/docs/dashboard.mdx`).
 * Anyone who can reach these routes can perform every action.
 */
import { json, queryOf, relativePath, type HandlerInput, type HandlerResult } from '../http';
import { ACTIONS, ACTIONS_BY_KIND } from './actions';
import { configRoute } from './config';
import { instanceRoute, instancesRoute } from './instances';
import { jobRoute, jobsRoute } from './jobs';
import { queuesRoute } from './queues';
import { scheduleRoute, schedulesRoute } from './schedules';
import { statsRoute } from './stats';
import { REQUESTED_WITH_HEADER, REQUESTED_WITH_MARKER } from '../../../shared/constants';
import type { PortQueue } from '@portqueue/core';
import type { DashboardClient } from '../../client';
import type { ActionKind, ActionPayloadDto } from '../../../shared/dto';
import type { Route } from './types';

export type { HandlerInput, HandlerResult } from '../http';
export type { Route, RouteContext } from './types';
export type { ActionContext, ActionRoute } from './actions';
export { ACTIONS, ACTIONS_BY_KIND };

/** The prefix every mutation posts under; the segment that follows names the action. */
export const ACTIONS_PATH_PREFIX = '/api/actions/';

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

    // Checked before anything reaches the database, and before the body is even parsed.
    const rejection = assertSameOrigin(method, input.headers);
    if (rejection) return rejection;

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

    if (method === 'POST' && path.startsWith(ACTIONS_PATH_PREFIX)) {
      return handleAction(portQueue, path.slice(ACTIONS_PATH_PREFIX.length), input.body);
    }
    if (method === 'GET') return handleRead(portQueue, path, queryOf(input.url));
    return json(404, { error: 'Not found' });
  }

  return { handle, isApiPath };
}

/**
 * Refuse a mutation that did not come from the dashboard's own client.
 *
 * A `GET` changes nothing and is left alone — reading the JSON API with `curl` should not need a
 * header. Everything else must carry the marker: a cross-origin page cannot set a custom header
 * without a preflight this mount never answers, so this is what stops another site purging a queue
 * with the operator's own cookies (or replayed basic credentials).
 */
export function assertSameOrigin(
  method: string,
  headers: Record<string, string | string[] | undefined>,
): HandlerResult | null {
  if (method === 'GET' || method === 'HEAD') return null;
  const raw = headers[REQUESTED_WITH_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === REQUESTED_WITH_MARKER) return null;
  return json(403, {
    error: `Missing or invalid ${REQUESTED_WITH_HEADER} header — a mutation must come from the dashboard client.`,
  });
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

/** Parse a mutation body and hand it to the action the URL segment names. */
async function handleAction(
  portQueue: PortQueue,
  segment: string,
  body: string | undefined,
): Promise<HandlerResult> {
  const route = ACTIONS_BY_KIND.get(decodeURIComponent(segment) as ActionKind);
  if (!route) return json(404, { error: 'Unknown action' });
  let action: ActionPayloadDto;
  try {
    // An action with no fields of its own still posts `{}`, so an empty body is a malformed request
    // rather than a shorthand for "no fields".
    action = JSON.parse(body ?? '') as ActionPayloadDto;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  if (!action || typeof action !== 'object') return json(400, { error: 'Invalid JSON body' });
  return route.handle({ portQueue, action });
}
