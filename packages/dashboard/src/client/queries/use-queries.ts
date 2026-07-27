/**
 * Query keys and the per-page polling hooks.
 *
 * Data fetching is TanStack Query; there is no bespoke cache, request-sequencing or dedup layer
 * here. That matters beyond tidiness — the hand-rolled hook this replaces had no abort and no
 * generation counter, so navigating job A → job B while A was still in flight could render A's
 * record under B's URL.
 *
 * **Polling is per-page and explicit.** Each page declares which of its queries are worth keeping
 * fresh and only those poll (`REFETCH_INTERVAL_MS`); nothing polls globally, and nothing polls
 * while the tab is hidden. `usePolledQuery` is the opt-in; `useOneShotQuery` is for reads that
 * only change when the user acts.
 */
import {
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { useLive } from '../components/LiveProvider';

/** The single shared refetch cadence for every polling query. */
export const REFETCH_INTERVAL_MS = 15_000;

/**
 * Every query key in one place, so a mutation can invalidate exactly what it affected instead of
 * guessing at a string. Keys are hierarchical: invalidating `['jobs']` covers every jobs query
 * regardless of its filters.
 */
export const queryKeys = {
  queues: (params?: unknown) => ['queues', params ?? {}] as const,
  stats: (queue?: string) => ['stats', queue ?? null] as const,
  jobs: (params?: unknown) => ['jobs', params ?? {}] as const,
  job: (jobId: string) => ['job', jobId] as const,
  schedules: (params?: unknown) => ['schedules', params ?? {}] as const,
  schedule: (scheduleId: string) => ['schedule', scheduleId] as const,
  instances: (params?: unknown) => ['instances', params ?? {}] as const,
  instance: (instanceKey: string) => ['instance', instanceKey] as const,
};

/** The root of each key family, for the broad invalidation a mutation does. */
export const queryRoots = [
  'queues',
  'stats',
  'jobs',
  'job',
  'schedules',
  'schedule',
  'instances',
  'instance',
];

/**
 * A query that reconciles on an interval while live-updates are on. Use it for the handful of
 * queries a page genuinely needs fresh — its table and its cards — not for everything it reads.
 *
 * `placeholderData: keep` holds the previous page's rows on screen while the next one loads, so
 * paging and filtering don't blank the table.
 */
export function usePolledQuery<T>(key: QueryKey, fetcher: () => Promise<T>): UseQueryResult<T> {
  const { live } = useLive();
  return useQuery({
    queryKey: key,
    queryFn: fetcher,
    // `false` stops the interval entirely when the user pauses live updates.
    refetchInterval: live ? REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: live,
    placeholderData: (previous) => previous,
  });
}

/** A query that loads once and refetches only on demand (or when a mutation invalidates it). */
export function useOneShotQuery<T>(key: QueryKey, fetcher: () => Promise<T>): UseQueryResult<T> {
  return useQuery({
    queryKey: key,
    queryFn: fetcher,
    placeholderData: (previous) => previous,
  });
}

/** Invalidate every dashboard query — what a mutation calls once it has succeeded. */
export function useRefreshAll(): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    for (const root of queryRoots) void client.invalidateQueries({ queryKey: [root] });
  }, [client]);
}
