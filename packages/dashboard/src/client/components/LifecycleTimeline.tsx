/**
 * Job lifecycle timeline (build_plan/12.4): a compact vertical timeline from the job's
 * lifecycle timestamps, showing the current status at the head and the duration between
 * transitions. Renders for every job (single-function or multi-step).
 */
import React from 'react';
import { Tag, Timeline, Typography } from 'antd';
import { tokens } from '@portqueue/ui';
import type { JobDto } from '../../shared/dto.js';
import { duration, formatDate } from './format.js';

interface Milestone {
  label: string;
  at: string | null | undefined;
  color: string;
}

export function LifecycleTimeline({ job }: { job: JobDto }): React.ReactElement {
  const milestones: Milestone[] = [
    { label: 'Created', at: job.createdAt, color: tokens.color.status.PENDING },
    { label: 'Started', at: job.startedAt, color: tokens.color.status.ACTIVE },
    { label: 'Retried', at: job.retriedAt, color: tokens.color.status.RETRY },
    { label: 'Stalled', at: job.stalledAt, color: tokens.color.status.STALLED },
    { label: 'Completed', at: job.completedAt, color: tokens.color.status.COMPLETED },
    { label: 'Failed', at: job.failedAt, color: tokens.color.status.FAILED },
    { label: 'Cancelled', at: job.cancelledAt, color: tokens.color.status.CANCELLED },
    { label: 'Expired', at: job.expiredAt, color: tokens.color.status.EXPIRED },
  ].filter((m) => m.at) as Milestone[];

  // Sort by time so out-of-declaration-order events (e.g. retried before completed) line up.
  milestones.sort(
    (a, b) => new Date(a.at as string).getTime() - new Date(b.at as string).getTime(),
  );

  const items = milestones.map((m, i) => {
    const prev = i > 0 ? milestones[i - 1] : undefined;
    return {
      color: m.color,
      children: (
        <div>
          <Typography.Text strong>{m.label}</Typography.Text>{' '}
          <Typography.Text type="secondary">{formatDate(m.at)}</Typography.Text>
          {prev && (
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                +{duration(prev.at, m.at)} since {prev.label.toLowerCase()}
              </Typography.Text>
            </div>
          )}
        </div>
      ),
    };
  });

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Tag color="processing">Now: {job.status}</Tag>
        <Typography.Text type="secondary">
          Attempt {job.retryAttempt} / {job.retryMaxAttempts}
        </Typography.Text>
      </div>
      {items.length ? (
        <Timeline items={items} />
      ) : (
        <Typography.Text type="secondary">No lifecycle events yet.</Typography.Text>
      )}
    </div>
  );
}
