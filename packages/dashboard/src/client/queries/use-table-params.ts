/**
 * Table state that lives in the URL: page number, search term and applied filters. Keeping
 * them in the query string (`#/queues/emails?jobs.page=3&jobs.status=FAILED`) makes a table
 * view linkable and survives a reload or a back/forward step.
 *
 * Each table on a page owns a `prefix` so two tables never collide.
 */
import { useCallback, useMemo, useRef } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

/** Rows per page — the single page size across the dashboard. */
export const PAGE_SIZE = 20;

export interface TableParams<K extends string = string> {
  /** 1-based page number. */
  page: number;
  search: string;
  /** Applied filter values by filter key; absent keys mean "no filter". */
  filters: Partial<Record<K, string[]>>;
  setPage: (page: number) => void;
  setSearch: (search: string) => void;
  setFilters: (filters: Partial<Record<K, string[]>>) => void;
  /** Row offset for the current page — what the API's `offset` wants. */
  offset: number;
}

const asPage = (raw: string | null): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
};

export function useTableParams<K extends string>(
  prefix: string,
  filterKeys: readonly K[] = [],
): TableParams<K> {
  const history = useHistory();
  const location = useLocation();

  const pageKey = `${prefix}.page`;
  const searchKey = `${prefix}.q`;
  const filterKey = (key: string): string => `${prefix}.${key}`;

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const page = asPage(params.get(pageKey));
  const search = params.get(searchKey) ?? '';

  const filters = useMemo(() => {
    const out: Partial<Record<K, string[]>> = {};
    for (const key of filterKeys) {
      const raw = params.get(filterKey(key));
      const values = raw ? raw.split(',').filter(Boolean) : [];
      if (values.length) out[key] = values;
    }
    return out;
  }, [params, filterKeys]);

  // The setters read the live location through a ref, so they keep a stable identity — a URL
  // change must not restart the debounce timer that owns `setSearch`.
  const locationRef = useRef(location);
  locationRef.current = location;

  /** Merge query-param updates (undefined deletes) and navigate. */
  const write = useCallback(
    (updates: Record<string, string | undefined>, replace: boolean): void => {
      const { pathname, search: current } = locationRef.current;
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      const to = `${pathname}${qs ? `?${qs}` : ''}`;
      if (replace) history.replace(to);
      else history.push(to);
    },
    [history],
  );

  const setPage = useCallback(
    (next: number) => write({ [pageKey]: next > 1 ? String(next) : undefined }, false),
    [write, pageKey],
  );

  // A new search / filter set invalidates the current page, so both reset to page 1.
  const setSearch = useCallback(
    (next: string) => write({ [searchKey]: next || undefined, [pageKey]: undefined }, true),
    [write, searchKey, pageKey],
  );

  const setFilters = useCallback(
    (next: Partial<Record<K, string[]>>) => {
      const updates: Record<string, string | undefined> = { [pageKey]: undefined };
      for (const key of filterKeys) {
        const values = next[key] ?? [];
        updates[filterKey(key)] = values.length ? values.join(',') : undefined;
      }
      write(updates, false);
    },
    [write, pageKey, filterKeys],
  );

  return { page, search, filters, setPage, setSearch, setFilters, offset: (page - 1) * PAGE_SIZE };
}

export interface FilterAndPageSpec<T> {
  /** Lower-cased search term match; only called when a term is present. */
  matches: (row: T, term: string) => boolean;
  /** Extra predicate for the applied filters. */
  keep?: (row: T) => boolean;
}

/**
 * Narrow a fully-loaded list, then slice the current page. Returns both the page rows and the
 * pre-slice total, so a table's "Results (n)" and its rows can never disagree.
 */
export function filterAndPage<T>(
  rows: T[],
  params: { page: number; search: string },
  spec: FilterAndPageSpec<T>,
): { rows: T[]; total: number } {
  const term = params.search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) => (spec.keep?.(row) ?? true) && (!term || spec.matches(row, term)),
  );
  const start = (params.page - 1) * PAGE_SIZE;
  return { rows: filtered.slice(start, start + PAGE_SIZE), total: filtered.length };
}
