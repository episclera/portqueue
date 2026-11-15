/**
 * A long value — a job id, a schedule id, an instance key — shortened in the middle
 * (`job-8f3a…c91e02`), with the full value in an antd `Tooltip`.
 *
 * Every middle-truncated value in the dashboard goes through this, so a reader can always recover
 * what was cut, the same way everywhere. An antd tooltip rather than a native `title`: it is styled,
 * appears promptly and opens on keyboard focus too. Nothing to explain means no tooltip — a value
 * short enough to show whole renders as plain text.
 *
 * Page titles are never truncated; this is for tables and other cramped places.
 */
import React from 'react';
import { Tooltip } from 'antd';
import { truncate } from './format';

export interface MiddleTruncateProps {
  value: string;
  /** Characters kept from the start. */
  head?: number;
  /** Characters kept from the end. */
  tail?: number;
}

export function MiddleTruncate({ value, head, tail }: MiddleTruncateProps): React.ReactElement {
  const shown = truncate(value, head, tail);
  if (shown === value) return <>{value}</>;
  return (
    <Tooltip title={value} placement="bottom">
      <span>{shown}</span>
    </Tooltip>
  );
}
