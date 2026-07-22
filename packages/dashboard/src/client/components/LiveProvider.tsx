/**
 * Global live-updates state: a persisted toggle that pauses interval
 * polling and the SSE stream, plus the shared 30s refetch cadence. One provider at the app
 * root; every polling page reads it through the hooks in `use-poll.ts`.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { eventsUrl } from '../queries/api.js';

/** Single shared refetch cadence; exposed here for future configurability. */
export const REFETCH_INTERVAL_MS = 30_000;

const STORAGE_KEY = 'portqueue-live-updates';

interface LiveContextValue {
  /** When true, pages poll + consume the SSE stream. */
  live: boolean;
  setLive: (v: boolean) => void;
  /** Monotonic counter bumped on relevant SSE events / manual refresh to trigger refetches. */
  pulse: number;
  /** Manual "Refresh now". */
  refreshNow: () => void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export function LiveProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [live, setLiveState] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  });
  const [pulse, setPulse] = useState(0);

  const setLive = useCallback((v: boolean) => {
    setLiveState(v);
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, v ? 'on' : 'off');
  }, []);

  const refreshNow = useCallback(() => setPulse((p) => p + 1), []);

  // Bridge SSE events → an early refetch pulse. Reconnects with backoff; disabled when paused.
  useEffect(() => {
    if (!live || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = (): void => {
      es = new EventSource(eventsUrl, { withCredentials: true });
      es.onmessage = () => setPulse((p) => p + 1);
      es.onerror = () => {
        es?.close();
        if (!closed) retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [live]);

  const value = useMemo<LiveContextValue>(
    () => ({ live, setLive, pulse, refreshNow }),
    [live, setLive, pulse, refreshNow],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive must be used within LiveProvider');
  return ctx;
}
