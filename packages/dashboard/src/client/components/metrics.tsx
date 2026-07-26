/**
 * Rendering for the per-instance health metrics an instance records on every heartbeat.
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
 * CPU is summed across cores, so >100 is normal on a multi-core box; these are deliberately
 * generous. Memory is a share of the whole machine, where sustained high values are the real
 * warning sign, so it trips earlier.
 */
export const CPU_THRESHOLDS: Thresholds = { warn: 70, danger: 90 };
export const MEMORY_THRESHOLDS: Thresholds = { warn: 75, danger: 90 };

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

/**
 * Bytes in the largest unit that keeps the number readable. Binary units (MiB) because that is
 * what `process.memoryUsage().rss` reports and what an operator compares against a container limit.
 */
export function formatBytes(value: number | null): string {
  if (value === null) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let n = value;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
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
