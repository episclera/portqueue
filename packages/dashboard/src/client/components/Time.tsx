/**
 * `<Time>` — the one way the dashboard puts a date on screen.
 *
 * One format, one behaviour: the exact local timestamp, `12 Mar. 2026 13:23:01 UTC+2`, rendered
 * once and never again until the value itself changes.
 *
 * It used to render "3 minutes ago" and keep it current with a shared page-wide ticker. That is
 * gone on purpose:
 *
 * - **A relative label is not the answer to "when".** "2 hours ago" next to a failed job still
 *   needs a hover, a mental subtraction, and a guess about which poll it was computed from.
 *   Correlating a failure with a deploy or a log line needs the clock time.
 * - **Nothing has to stay in sync.** With no `Date.now()` in the output, a timestamp is a pure
 *   function of its prop: no interval, no subscription, no re-render a second, and no cell that
 *   silently goes stale while live updates are paused.
 * - **Mixed modes were a coin toss.** Some cells were relative, some absolute, and the two never
 *   agreed on what a timestamp looks like. There is now exactly one format across every table,
 *   detail card and timeline.
 *
 * The label names the viewer's UTC offset, so it survives being screenshotted into a chat. The
 * machine-readable UTC instant rides along on `<time dateTime>`, and the native `title` shows it
 * on hover for anyone comparing against a UTC log.
 *
 * `stacked` splits those two facts onto two lines — the instant, then the offset in a lighter
 * grey. Table columns use it: the instant is what a reader scans down a column, and the offset is
 * the same on every row, so giving it equal weight on one long line only makes the column wider
 * and harder to read. Running text keeps the inline form.
 */
import React from 'react';
import styled from 'styled-components';
import { formatDateTime, formatDateTimeParts } from './format';

export interface TimeProps {
  /** An ISO timestamp. `null`/`undefined` renders the em dash the rest of the UI uses. */
  value: string | null | undefined;
  /**
   * Put the timezone on its own line below the instant, de-emphasised. For table cells; leave it
   * off for a timestamp inside a sentence, where a line break would read as a new thought.
   */
  stacked?: boolean;
}

/** Two lines that stay tight together — they are one value, not two rows. */
const Stack = styled.time`
  display: inline-block;
  line-height: 1.3;
`;

const Offset = styled.span`
  display: block;
  color: ${(p) => p.theme.color.textFaint};
  font-size: 12px;
`;

export function Time({ value, stacked = false }: TimeProps): React.ReactElement {
  const ms = value ? new Date(value).getTime() : Number.NaN;
  if (Number.isNaN(ms)) return <>—</>;

  const iso = new Date(ms).toISOString();

  if (stacked) {
    // Non-null: `ms` is already known to parse.
    const { instant, offset } = formatDateTimeParts(ms)!;
    return (
      <Stack dateTime={iso} title={iso}>
        {instant}
        <Offset>{offset}</Offset>
      </Stack>
    );
  }

  return (
    <time dateTime={iso} title={iso}>
      {formatDateTime(ms)}
    </time>
  );
}
