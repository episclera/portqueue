/**
 * Rendering for the process-health metrics an instance records on every heartbeat.
 *
 * One module so the instances table and the instance detail page agree on the formatting, on what
 * the numbers mean, and on the point at which one is worth an operator's attention — a value that
 * reads as a warning in a table and as fine on a detail page would be worse than no colour at all.
 */
import React from 'react';
import { Typography } from 'antd';

/**
 * Where a reading stops being comfortable. One pair for both metrics: now that CPU is a share of
 * every available core rather than of one core, both are 0-100 shares of a ceiling the process
 * cannot pass, so "75% of the way there" means the same thing for each.
 */
export const METRIC_THRESHOLDS = { warn: 75, danger: 85 };

/**
 * What the numbers are, wherever they are shown. Every surface says "process" out loud: a reader
 * who takes these for the machine's load would size a box off them, and a reader who takes the
 * memory share for machine RAM would miss that the ceiling is `--max-old-space-size`.
 */
export const METRIC_HINTS = {
  cpu: 'This Node process’s CPU since the last heartbeat, as a share of all the cores available to it — 100% means it is using every core. Not the machine’s load',
  memory:
    'This Node process’s used heap as a share of the limit V8 would abort at (--max-old-space-size) — not the machine’s memory',
};

/** A percentage to one decimal, or an em dash before the instance's first heartbeat. */
export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

export type MetricTone = 'normal' | 'warn' | 'danger';

/** Null reads as `normal`: no heartbeat yet is not a health problem. */
export function metricTone(value: number | null): MetricTone {
  if (value === null) return 'normal';
  if (value >= METRIC_THRESHOLDS.danger) return 'danger';
  if (value >= METRIC_THRESHOLDS.warn) return 'warn';
  return 'normal';
}

export interface MetricValueProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The formatted text to show. */
  children: React.ReactNode;
  tone: MetricTone;
}

/**
 * A metric reading, coloured only once it is worth an operator's attention. Forwards its ref and
 * props because a `Tooltip` wraps it in both tables: antd anchors the bubble on the child's DOM node.
 */
export const MetricValue = React.forwardRef<HTMLSpanElement, MetricValueProps>(function MetricValue(
  { children, tone, ...rest },
  ref,
): React.ReactElement {
  return (
    <Typography.Text
      {...rest}
      ref={ref}
      {...(tone === 'normal' ? {} : { type: tone === 'warn' ? 'warning' : 'danger', strong: true })}
      title={tone === 'normal' ? undefined : `Running ${tone}`}
      style={{
        color: tone === 'normal' ? 'inherit' : undefined,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {children}
    </Typography.Text>
  );
});
