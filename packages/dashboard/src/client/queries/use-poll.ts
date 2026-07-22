/**
 * Shared data-fetching hooks. `useQuery` fetches once and on `pulse`;
 * `usePoll` layers the 30s reconciliation interval on top, pausing while the tab is hidden
 * and refetching immediately on focus. Background/non-blocking: data updates in place without
 * clearing the previous view.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { REFETCH_INTERVAL_MS, useLive } from '../components/LiveProvider.js';

export interface QueryState<T> {
  data: T | undefined;
  error: Error | undefined;
  /** True only on the very first load (no data yet); background refetches don't set this. */
  loading: boolean;
  /** True during any refetch (including background). */
  refetching: boolean;
  refetch: () => void;
}

/**
 * One-shot query that refetches on the global `pulse` (SSE/manual). `deps` re-run the fetch
 * (e.g. route params / filters). Does not poll on its own — use `usePoll` for that.
 */
export function useQuery<T>(fetcher: () => Promise<T>, deps: readonly unknown[]): QueryState<T> {
  const { pulse } = useLive();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const hasData = useRef(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    if (hasData.current) setRefetching(true);
    else setLoading(true);
    try {
      const next = await fetcherRef.current();
      setData(next);
      setError(undefined);
      hasData.current = true;
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
      setRefetching(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [...deps, pulse]);

  return { data, error, loading, refetching, refetch: () => void run() };
}

/**
 * Polling query for data-heavy pages. Polls every {@link REFETCH_INTERVAL_MS} while live and
 * visible; pauses when the tab is hidden or live-updates are off; refetches on focus and pulse.
 */
export function usePoll<T>(fetcher: () => Promise<T>, deps: readonly unknown[]): QueryState<T> {
  const { live } = useLive();
  const state = useQuery(fetcher, deps);
  const refetchRef = useRef(state.refetch);
  refetchRef.current = state.refetch;

  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = (): void => {
      if (timer) return;
      timer = setInterval(() => {
        if (!document.hidden) refetchRef.current();
      }, REFETCH_INTERVAL_MS);
    };
    const stop = (): void => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = (): void => {
      if (document.hidden) {
        stop();
      } else {
        refetchRef.current(); // immediate reconcile on focus
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [live]);

  return state;
}
