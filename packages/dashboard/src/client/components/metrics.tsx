/**
 * Rendering for the process-health metrics an instance records on every heartbeat.
 *
 * One module so the instances table and the instance detail page agree on the formatting and on
 * what the numbers mean.
 *
 * **The readings are never coloured.** There is no value at which CPU or memory is "bad" on its
 * own: a batch worker is *meant* to run hot, and a heap near V8's limit is normal for a process
 * that was given a small one. A red number would be an alarm the dashboard cannot justify —
 * whether a process is under pressure is what the `systemLimiter` thresholds decide, against
 * limits only the operator knows.
 */
import React from 'react';
import styled from 'styled-components';

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

const Reading = styled.span`
  font-variant-numeric: tabular-nums;
`;

export interface MetricValueProps {
  /** The formatted text to show. */
  children: React.ReactNode;
}

/** A metric reading, in the normal text colour whatever its value. */
export function MetricValue({ children }: MetricValueProps): React.ReactElement {
  return <Reading>{children}</Reading>;
}
