import React from 'react';
import { Tag } from './Tag';
import { tokens, type StatusColorKey } from '../theme/tokens';

export interface StatusTagProps {
  /** The raw state value — this is what picks the colour. */
  status: string;
  /** Display text; defaults to `status`. Pass a friendly label without losing the colour. */
  label?: React.ReactNode;
}

/**
 * The single source of truth for JobStatus → colour, shared by the dashboard and any docs
 * example so states render identically everywhere. The colour is always resolved from
 * `status`, never from the displayed label.
 */
export function StatusTag({ status, label }: StatusTagProps): React.ReactElement {
  const key = status.toUpperCase() as StatusColorKey;
  const color = tokens.color.status[key] ?? tokens.color.status.PENDING;
  return (
    <Tag color={color} variant="outline" pill>
      {label ?? status}
    </Tag>
  );
}
