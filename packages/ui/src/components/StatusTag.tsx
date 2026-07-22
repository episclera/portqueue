import React from 'react';
import { Tag } from 'antd';
import { tokens, type StatusColorKey } from '../theme/tokens.js';

export interface StatusTagProps {
  status: string;
}

/**
 * The single source of truth for JobStatus → color, shared by the
 * dashboard and any docs example so states render identically everywhere.
 */
export function StatusTag({ status }: StatusTagProps): React.ReactElement {
  const key = status.toUpperCase() as StatusColorKey;
  const color = tokens.color.status[key] ?? tokens.color.status.PENDING;
  return (
    <Tag
      style={{
        color,
        borderColor: color,
        background: 'transparent',
        borderRadius: tokens.radii.pill,
        fontWeight: 600,
        fontSize: 12,
      }}
    >
      {status}
    </Tag>
  );
}
