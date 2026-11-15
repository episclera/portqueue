/**
 * Every tag the dashboard draws, and every state it shows as one.
 *
 * **One look for every tag:** a 1px border in exactly the text's colour, over a much lighter tint
 * of that same colour, so the text always reads and the tag always has an edge. `ToneTag` is the
 * only place that look is built — `StatusTag`, the state tags below and the filter chips all go
 * through it — so no tag can drift back to antd's own presets (a borderless fill, or a border
 * paler than its text).
 *
 * The state colours follow one scale: green is healthy and doing its job, amber is deliberately
 * held back, red is refusing work outright, grey is inactive. Job statuses use `@portqueue/theme`'s
 * status palette instead (`StatusTag`).
 */
import React from 'react';
import { Tag, theme } from 'antd';
import type { TagProps } from 'antd';
import { LIVENESS_CONFIG, SCHEDULE_STATES_CONFIG, pauseStateLabel } from '../constants/labels';

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

/** How much of the colour the background keeps: light enough that the text reads on it. */
const TINT_PERCENT = 12;

export interface ToneTagProps extends Omit<TagProps, 'color' | 'variant'> {
  /** A semantic tone from the theme, or `color` for an exact colour (a job status). */
  tone?: Tone;
  color?: string;
}

/** A tag whose border and text share one colour, over a light tint of it. */
export function ToneTag({
  tone = 'neutral',
  color,
  style,
  ...rest
}: ToneTagProps): React.ReactElement {
  const { token } = theme.useToken();
  const tones: Record<Tone, string> = {
    success: token.colorSuccess,
    warning: token.colorWarning,
    error: token.colorError,
    info: token.colorInfo,
    neutral: token.colorTextSecondary,
  };
  const ink = color ?? tones[tone];
  return (
    <Tag
      {...rest}
      variant="outlined"
      style={{
        color: ink,
        borderColor: ink,
        background: `color-mix(in srgb, ${ink} ${TINT_PERCENT}%, transparent)`,
        ...style,
      }}
    />
  );
}

/** A queue's or instance's pause state: running, paused (processing), or paused (all). */
export function PauseStateTag({
  row,
}: {
  row: { processingPaused: boolean; acceptingPaused?: boolean };
}): React.ReactElement {
  const tone: Tone = !row.processingPaused ? 'success' : row.acceptingPaused ? 'error' : 'warning';
  return <ToneTag tone={tone}>{pauseStateLabel(row)}</ToneTag>;
}

/** Whether an instance is still heartbeating. A stale one is inactive, not failing. */
export function LivenessTag({ alive }: { alive: boolean }): React.ReactElement {
  return (
    <ToneTag tone={alive ? 'success' : 'neutral'}>
      {alive ? LIVENESS_CONFIG.alive.label : LIVENESS_CONFIG.stale.label}
    </ToneTag>
  );
}

/** Whether a schedule is armed. Disabled is a deliberate hold, so it reads amber, not grey. */
export function ScheduleStateTag({ enabled }: { enabled: boolean }): React.ReactElement {
  return (
    <ToneTag tone={enabled ? 'success' : 'warning'}>
      {enabled ? SCHEDULE_STATES_CONFIG.enabled.label : SCHEDULE_STATES_CONFIG.disabled.label}
    </ToneTag>
  );
}

/** A yes/no state such as "stalled": amber when it is true, since a stall wants a look. */
export function FlagTag({ on }: { on: boolean }): React.ReactElement {
  return <ToneTag tone={on ? 'warning' : 'neutral'}>{on ? 'Yes' : 'No'}</ToneTag>;
}
