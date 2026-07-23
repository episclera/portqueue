import React from 'react';
import { Tag } from './Tag';
import { tokens, type StatusColorKey } from '../theme/tokens';

export interface StatusTagProps {
  status: string;
}

/**
 * The single source of truth for JobStatus → colour, shared by the dashboard and any docs
 * example so states render identically everywhere.
 */
export function StatusTag({ status }: StatusTagProps): React.ReactElement {
  const key = status.toUpperCase() as StatusColorKey;
  const color = tokens.color.status[key] ?? tokens.color.status.PENDING;
  return (
    <Tag color={color} variant="outline" pill>
      {status}
    </Tag>
  );
}
