/**
 * `<Time>` — a timestamp that stays correct without re-rendering anything above it.
 *
 * The problem it solves: "2 minutes ago" computed during render is only true until the next
 * render. Between polls it silently goes stale, and with live updates paused it freezes for as
 * long as the tab stays open.
 *
 * How it stays cheap:
 *
 * - **One shared ticker for the whole page.** A single `setInterval` (module scope) fires once a
 *   second and notifies subscribed cells. A hundred timestamps cost one timer, not a hundred, and
 *   the interval only exists while at least one `<Time>` is mounted.
 * - **The state is a tick counter, not the formatted text.** `useSyncExternalStore` returns the
 *   monotonic tick; the label is derived during render from `Date.now()`. Nothing has to keep the
 *   rendered string in sync with the clock, and a parent re-render simply recomputes it from the
 *   current time.
 * - **Only this component re-renders.** The subscription lives inside `<Time>`, so a tick updates
 *   the cell and nothing else — a table of 200 rows never re-renders its parent once a second.
 * - **Only cells that can change subscribe.** Anything older than an hour rounds to the same text
 *   for at least a minute, so those cells skip the ticker entirely and re-render only when their
 *   parent does. That is the common case in a job table full of finished work.
 */
import React, { useCallback, useMemo, useSyncExternalStore } from 'react';
import { Tooltip } from '@portqueue/ui';
import { absoluteTime, relativeTime } from './format';

/** How often the ticker fires. One second is the finest granularity the labels express. */
const TICK_MS = 1000;

/** Below this age the label changes within a second or a minute, so the cell must subscribe. */
const FAST_CHANGING_MS = 60 * 60 * 1000;

let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

/**
 * Subscribe to the shared ticker. The interval starts with the first subscriber and is cleared
 * with the last, so an unmounted page leaves no timer running.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    timer = setInterval(() => {
      tick += 1;
      for (const fn of listeners) fn();
    }, TICK_MS);
    // Never hold a Node process (or a jsdom test) open just to update a label.
    timer.unref?.();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getTick = (): number => tick;
/** On the server there is no ticker; the first render's value is stable and correct. */
const getServerTick = (): number => 0;

export interface TimeProps {
  /** An ISO timestamp. `null`/`undefined` renders the em dash the rest of the UI uses. */
  value: string | null | undefined;
  /**
   * `'relative'` (default) shows "3 minutes ago" and keeps it current; `'absolute'` shows the
   * full local timestamp, which never changes and so never subscribes to the ticker.
   */
  mode?: 'relative' | 'absolute';
  /** Show the exact timestamp on hover. On by default — a relative label alone is ambiguous. */
  tooltip?: boolean;
}

export function Time({ value, mode = 'relative', tooltip = true }: TimeProps): React.ReactElement {
  const parsed = useMemo(() => {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
  }, [value]);

  // A cell only needs the ticker while its label is still changing minute to minute.
  const needsTicker =
    mode === 'relative' && parsed !== null && Math.abs(Date.now() - parsed) < FAST_CHANGING_MS;

  const noopSubscribe = useCallback(() => () => {}, []);
  // Hooks can't be called conditionally, so the subscription is always set up — but a cell that
  // doesn't need it subscribes to nothing and is never woken.
  useSyncExternalStore(needsTicker ? subscribe : noopSubscribe, getTick, getServerTick);

  if (parsed === null) return <>—</>;

  const label = mode === 'absolute' ? absoluteTime(parsed) : relativeTime(parsed);
  if (!tooltip) return <>{label}</>;
  return (
    <Tooltip title={absoluteTime(parsed)} placement="top">
      <time dateTime={new Date(parsed).toISOString()}>{label}</time>
    </Tooltip>
  );
}
