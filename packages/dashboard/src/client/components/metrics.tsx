/**
 * Rendering for the machine-health metrics an instance records on every heartbeat.
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
 * Both metrics are shares of the whole machine (0-100), so the same scale reads the same way for
 * each: busy is fine, sustained near-full is the warning sign.
 */
export const CPU_THRESHOLDS: Thresholds = { warn: 70, danger: 90 };
export const MEMORY_THRESHOLDS: Thresholds = { warn: 75, danger: 90 };

/**
 * What the numbers are, wherever they are shown. Every surface says "machine" out loud: the same
 * figures repeat for two instances on one host, and a reader who assumes they are this Node
 * process's usage would draw the wrong conclusion from both.
 */
export const METRIC_HINTS = {
  cpu: 'Machine-wide CPU: the share of all cores busy since the last heartbeat, for the whole host — not this Node process',
  memory:
    'Machine-wide memory: used memory as a share of the host’s total — not this Node process’s heap or RSS',
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
