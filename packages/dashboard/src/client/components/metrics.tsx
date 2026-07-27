/**
 * Rendering for the process-health metrics an instance records on every heartbeat.
 *
 * One module so the instances table and the instance detail page agree on both the formatting and
 * the point at which a number counts as "high" — a value that reads as a warning in a table and as
 * fine on a detail page would be worse than no colour at all.
 */
import React from 'react';
import styled from 'styled-components';

/** Where a metric stops being comfortable. Below `warn` it is rendered in the normal text colour. */
interface Thresholds {
  warn: number;
  danger: number;
}

/**
 * The two metrics are on different scales, so they don't share one.
 *
 * CPU is a share of **one core**, the way `top` reports a process, so 100 means the main thread is
 * pegged — the warning sits just under it and anything past it is a process that has run out of
 * single-threaded headroom. Memory is a share of V8's heap limit, where 100 is the OOM abort, so
 * it turns red earlier: a heap that stays near its ceiling is one allocation from a crash.
 */
export const CPU_THRESHOLDS: Thresholds = { warn: 80, danger: 100 };
export const MEMORY_THRESHOLDS: Thresholds = { warn: 75, danger: 90 };

/**
 * What the numbers are, wherever they are shown. Every surface says "process" out loud: a reader
 * who takes these for the machine's load would size a box off them, and a reader who takes the
 * memory share for machine RAM would miss that the ceiling is `--max-old-space-size`.
 */
export const METRIC_HINTS = {
  cpu: 'This Node process’s CPU since the last heartbeat, as a share of one core (like `top`) — 100% is one core saturated, and threaded work can exceed it. Not the machine’s load',
  memory:
    'This Node process’s used heap as a share of the limit V8 would abort at (--max-old-space-size) — not the machine’s memory',
};

export type MetricTone = 'normal' | 'warn' | 'danger';

export function metricTone(value: number | null, thresholds: Thresholds): MetricTone {
  if (value === null) return 'normal';
  if (value >= thresholds.danger) return 'danger';
  if (value >= thresholds.warn) return 'warn';
  return 'normal';
}

/** A percentage to one decimal, or an em dash before the instance's first heartbeat. */
export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

const Toned = styled.span<{ $tone: MetricTone }>`
  color: ${(p) =>
    p.$tone === 'danger'
      ? p.theme.color.danger
      : p.$tone === 'warn'
        ? p.theme.color.warning
        : 'inherit'};
  font-variant-numeric: tabular-nums;
  font-weight: ${(p) => (p.$tone === 'normal' ? 'inherit' : 600)};
`;

export interface MetricValueProps {
  /** The formatted text to show. */
  children: React.ReactNode;
  tone: MetricTone;
}

/** A metric reading, coloured only once it is worth an operator's attention. */
export function MetricValue({ children, tone }: MetricValueProps): React.ReactElement {
  return (
    <Toned $tone={tone} title={tone === 'normal' ? undefined : `Running ${tone}`}>
      {children}
    </Toned>
  );
}
