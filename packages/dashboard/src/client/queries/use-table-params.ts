/**
 * Table state that lives in the URL: page number, search term and applied filters. Keeping them
 * in the query string (`#/queues/emails?jobs.page=3&jobs.status=FAILED`) makes a table view
 * linkable and survives a reload or a back/forward step.
 *
 * Each table on a page owns a `prefix` so two tables never collide.
 *
 * Every table is server-paged, so this hook only carries the state — it never slices rows. The
 * one derived value it owns is the clamp in {@link clampedPage}: a filter that shrinks the result
 * set below the current page must not leave the user staring at an empty table that claims a
 * non-zero result count.
 */
import { useCallback, useMemo, useRef } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

/**
 * Rows per page — the single page size across the dashboard, deliberately fixed.
 *
 * A page-size control and sortable column headers are the two obvious additions here, and both
 * are deliberately absent. Twenty rows is a screenful; someone who needs a different slice
 * reaches for a filter or the search box, which narrow the set rather than just enlarging the
 * page. Sorting is the same story in reverse: every table already arrives in the order that
 * answers its question (newest jobs first, queues by name), and making a header sortable means
 * pushing an `order` into the URL, the query key and the API for every column, on tables whose
 * useful orderings a filter expresses better. Neither is free, and neither answers a question the
 * current controls leave open.
 */
export const PAGE_SIZE = 20;

export interface TableParams<K extends string = string> {
  /** 1-based page number, as it appears in the URL. */
  page: number;
  search: string;
  /** Applied filter values by filter key; absent keys mean "no filter". */
  filters: Partial<Record<K, string[]>>;
  setPage: (page: number) => void;
  setSearch: (search: string) => void;
  setFilters: (filters: Partial<Record<K, string[]>>) => void;
  /** Clear one filter key — what a dismissible chip in the toolbar does. */
  clearFilter: (key: K, value?: string) => void;
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
  const filterKey = useCallback((key: string): string => `${prefix}.${key}`, [prefix]);

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
  }, [params, filterKeys, filterKey]);

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
    [write, pageKey, filterKeys, filterKey],
  );

  /** Drop one filter value, or the whole key when no value is named. */
  const clearFilter = useCallback(
    (key: K, value?: string) => {
      const current = filters[key] ?? [];
      const next = value === undefined ? [] : current.filter((v) => v !== value);
      write(
        { [filterKey(key)]: next.length ? next.join(',') : undefined, [pageKey]: undefined },
        false,
      );
    },
    [write, filters, filterKey, pageKey],
  );

  return {
    page,
    search,
    filters,
    setPage,
    setSearch,
    setFilters,
    clearFilter,
    offset: (page - 1) * PAGE_SIZE,
  };
}

/**
 * The page actually worth requesting, given how many rows the query matched.
 *
 * Sitting on page 3 and typing a search that narrows the set to five rows would otherwise request
 * offset 40 of 5 and render an empty table under a "Results (5)" heading. Clamping to the last
 * page that holds rows keeps the two consistent.
 */
export function clampedPage(page: number, total: number): number {
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return Math.min(Math.max(page, 1), lastPage);
}
