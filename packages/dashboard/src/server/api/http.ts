/**
 * The request/response shapes every route speaks, and the two helpers that build a reply.
 *
 * Deliberately tiny and framework-free: an adapter translates its framework's request into
 * {@link HandlerInput}, the router hands back a {@link HandlerResult}, and the adapter writes it.
 * Nothing here knows about Node's `http`, so a route is a pure function of its input.
 */

export interface HandlerInput {
  method: string;
  /** URL path + query, already stripped to be relative-friendly (may still include basePath). */
  url: string;
  body: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}

export interface HandlerResult {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

const JSON_HEADERS: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };

/** A JSON reply. Every route returns one of these — there is no other response shape. */
export function json(
  status: number,
  payload: unknown,
  extra?: Record<string, string>,
): HandlerResult {
  return { status, body: JSON.stringify(payload), headers: { ...JSON_HEADERS, ...extra } };
}

/**
 * A 409 carrying the actionable message core threw (queue in use, instance still active, …).
 * Those refusals are the caller's problem to fix, not a server fault, so they must not read as 500s.
 */
export function conflict(err: unknown, fallback: string): HandlerResult {
  return json(409, { error: err instanceof Error ? err.message : fallback });
}

/** Strip the mount base path so route matching sees `/api/...`. */
export function relativePath(url: string, basePath: string): string {
  const qIndex = url.indexOf('?');
  let path = qIndex === -1 ? url : url.slice(0, qIndex);
  if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length);
  if (!path.startsWith('/')) path = `/${path}`;
  return path;
}

/** The query string of a URL, as `URLSearchParams` (empty when there isn't one). */
export function queryOf(url: string): URLSearchParams {
  const qIndex = url.indexOf('?');
  return new URLSearchParams(qIndex === -1 ? '' : url.slice(qIndex + 1));
}
