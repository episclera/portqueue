/**
 * Global live-updates state: a persisted toggle that pauses the interval polling every page's
 * queries do. One provider at the app root; the polling hooks in `queries/use-queries.ts` read it.
 *
 * There is no event stream. The dashboard reconciles on a fixed interval and immediately after a
 * mutation, which is all a monitoring UI needs, and costs one predictable query per visible page
 * rather than a long-lived connection holding 19 listeners on the producer's event bus per tab.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const STORAGE_KEY = 'portqueue-live-updates';

interface LiveContextValue {
  /** When true, each page's polling queries reconcile on the shared interval. */
  live: boolean;
  setLive: (v: boolean) => void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export function LiveProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [live, setLiveState] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  });

  const setLive = useCallback((v: boolean) => {
    setLiveState(v);
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, v ? 'on' : 'off');
  }, []);

  const value = useMemo<LiveContextValue>(() => ({ live, setLive }), [live, setLive]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive must be used within LiveProvider');
  return ctx;
}
