/**
 * Small formatting helpers shared across pages. The timestamp one takes epoch milliseconds and is
 * pure — `<Time>` is the component that puts it on screen (see `Time.tsx`).
 */

/**
 * Month names as the dashboard's one date format spells them: abbreviated with a trailing period,
 * except May, which isn't an abbreviation. Fixed rather than `Intl`-derived, so the same instant
 * reads identically in every browser locale — one format for the whole UI, screenshots included.
 */
const MONTHS = [
  'Jan.',
  'Feb.',
  'Mar.',
  'Apr.',
  'May',
  'Jun.',
  'Jul.',
  'Aug.',
  'Sep.',
  'Oct.',
  'Nov.',
  'Dec.',
] as const;

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * A UTC offset as `UTC`, `UTC+2` or `UTC-5:30`, from minutes **ahead of** UTC.
 *
 * Spelled out from the offset rather than taken from `Intl`'s `timeZoneName`, whose wording shifts
 * with the browser locale ("GMT+2", "CEST", "Central European Summer Time"). An offset is
 * unambiguous everywhere, and it is the part a shared screenshot otherwise leaves the reader
 * guessing at.
 */
export function utcOffsetLabel(minutesAheadOfUtc: number): string {
  if (!minutesAheadOfUtc) return 'UTC';
  const sign = minutesAheadOfUtc > 0 ? '+' : '-';
  const abs = Math.abs(minutesAheadOfUtc);
  const minutes = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${minutes ? `:${pad(minutes)}` : ''}`;
}

/**
 * The dashboard's only timestamp format, split into the two things it says: the instant
 * (`12 Mar. 2026 13:23:01`) and the timezone it is expressed in (`UTC+2`).
 *
 * Kept as parts because a table cell stacks them on two lines — the instant is what you read, the
 * offset is context — while running text wants the one-line form. Both spellings come from here,
 * so a stacked cell and an inline label can never drift apart.
 *
 * Day, hour, minute and second are zero-padded, so every timestamp is the same width and a column
 * of them lines up. Every field is read with the local `Date` getters — no locale, no `Intl`, and
 * nothing that varies between two people looking at the same row.
 */
export function formatDateTimeParts(ms: number): { instant: string; offset: string } | null {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const date = `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  // `getTimezoneOffset()` counts minutes *behind* UTC, so east of Greenwich is negative.
  return { instant: `${date} ${time}`, offset: utcOffsetLabel(-d.getTimezoneOffset()) };
}

/**
 * The same timestamp on one line: `12 Mar. 2026 13:23:01 UTC+2`, in the viewer's own timezone,
 * with that timezone's offset named.
 */
export function formatDateTime(ms: number): string {
  const parts = formatDateTimeParts(ms);
  if (!parts) return '—';
  return `${parts.instant} ${parts.offset}`;
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
