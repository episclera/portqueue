/**
 * Query-string parsing shared by the read routes. Every value a client can send arrives as a
 * string, so each reader here is the one place that decides what a missing, blank or nonsense
 * value means — and the answer is always "don't narrow", never "guess".
 */
import {
  DASHBOARD_MAX_PAGE_LIMIT,
  DEFAULT_PAGE_LIMIT,
  JobStatus,
  type GetJobsQuery,
  type JobInstanceFilter,
} from '@portqueue/core';

/** Read a paging window, clamped to the ceiling core's dashboard facade would clamp to anyway. */
export function paging(params: URLSearchParams): { limit: number; offset: number } {
  const rawLimit = Number(params.get('limit'));
  const rawOffset = Number(params.get('offset'));
  return {
    limit:
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.trunc(rawLimit), DASHBOARD_MAX_PAGE_LIMIT)
        : DEFAULT_PAGE_LIMIT,
    offset: Number.isFinite(rawOffset) && rawOffset > 0 ? Math.trunc(rawOffset) : 0,
  };
}

/** A tri-state boolean query param: `true`/`false` narrow, anything else means "don't filter". */
export function triBool(raw: string | null): boolean | undefined {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

/** A non-empty string param, or `undefined` — so `?search=` reads as "no search". */
export function text(params: URLSearchParams, key: string): string | undefined {
  const raw = params.get(key);
  return raw ? raw : undefined;
}

/**
 * Spread a named filter into an options object only when it is set. Keeps every route's query
 * assembly to one line per filter, instead of a conditional spread per filter.
 */
export function when<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** A comma-separated status list, ignoring anything that isn't a `JobStatus`. */
export function statuses(raw: string | null): JobStatus[] | undefined {
  if (!raw) return undefined;
  const valid = new Set<string>(Object.values(JobStatus));
  const out = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => valid.has(s)) as JobStatus[];
  return out.length ? out : undefined;
}

/** The job filter both `/api/jobs` and the job detail route build from a query string. */
export function jobsQuery(params: URLSearchParams): GetJobsQuery & JobInstanceFilter {
  return {
    ...paging(params),
    ...when('queue', text(params, 'queue')),
    ...when('statuses', statuses(params.get('statuses'))),
    ...when('scheduleId', text(params, 'scheduleId')),
    ...when('instanceKey', text(params, 'instanceKey')),
  };
}
