/**
 * A job status as an antd `Tag`, coloured from `@portqueue/theme`'s status palette — the one
 * mapping from status to colour, so a state looks the same in every table, header and card.
 */
import React from 'react';
import { Tag } from 'antd';
import { statusColor } from '@portqueue/theme';

export interface StatusTagProps {
  /** The raw state value — this is what picks the colour. */
  status: string;
  /** Display text; defaults to `status`. Pass a friendly label without losing the colour. */
  label?: React.ReactNode;
}

export function StatusTag({ status, label }: StatusTagProps): React.ReactElement {
  return (
    <Tag color={statusColor(status)} variant="outlined">
      {label ?? status}
    </Tag>
  );
}
