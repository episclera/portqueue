/**
 * Small formatting helpers shared across pages. The timestamp ones take epoch milliseconds and
 * are pure — `<Time>` owns deciding *when* to recompute them (see `Time.tsx`).
 */

/**
 * The full local timestamp, with the timezone named. `toLocaleString()` alone is ambiguous the
 * moment anyone shares a screenshot across regions, so the zone is always spelled out.
 */
export function absoluteTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { timeZoneName: 'short' });
}

/** "3 minutes ago" / "in 2 hours", relative to now. */
export function relativeTime(ms: number): string {
  if (Number.isNaN(ms)) return '—';
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}

/** Human-readable duration between two ISO timestamps. */
export function duration(fromIso?: string | null, toIso?: string | null): string {
  if (!fromIso || !toIso) return '—';
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`;
}

export function truncate(id: string | null | undefined, head = 8, tail = 6): string {
  if (!id) return '—';
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** Sum every known status count. */
export function totalCount(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
}
