/**
 * The shape of one read route.
 *
 * Same idea as the CLI's `Command`: a route is a self-describing object, and the registry in
 * `index.ts` derives dispatch from the list — so adding a route is adding a file and one entry, with
 * no `if (path === …)` chain to extend and no second place to keep in sync.
 */
import type { PortQueue } from '@portqueue/core';
import type { HandlerResult } from '../http';

export interface RouteContext {
  /** The dashboard's own headless client, already connected. */
  readonly portQueue: PortQueue;
  /** The request's query string. */
  readonly query: URLSearchParams;
  /**
   * Path segments captured by a `path` pattern, already URL-decoded. A route with a literal string
   * `path` never has any.
   */
  readonly params: readonly string[];
}

export interface Route {
  /** Only `GET` today; reads are routed by path, mutations by {@link ActionKind}. */
  readonly method: 'GET';
  /** A literal path, or a pattern whose capture groups become {@link RouteContext.params}. */
  readonly path: string | RegExp;
  /** One-line description of what this route serves; the registry is the API's index. */
  readonly summary: string;
  handle(ctx: RouteContext): Promise<HandlerResult>;
}
