/**
 * Job lifecycle timeline: a compact vertical timeline from the job's lifecycle timestamps,
 * showing the current status at the head and the duration between transitions. Renders for
 * every job (single-function or multi-step).
 */
import React from 'react';
import { Flex, Tag, Timeline, Typography } from 'antd';
import type { TimelineItemProps } from 'antd';
import { tokens } from '@portqueue/theme';
import type { JobDto } from '../../shared/dto';
import { STALLED, statusLabel } from '../constants/labels';
import { duration } from './format';
import { Time } from './Time';

interface Milestone {
  label: string;
  at: string | null | undefined;
  color: string;
}

export function LifecycleTimeline({ job }: { job: JobDto }): React.ReactElement {
  const milestones: Milestone[] = [
    { label: 'Created', at: job.createdAt, color: tokens.status.PENDING },
    { label: 'Started', at: job.startedAt, color: tokens.status.ACTIVE },
    { label: 'Retried', at: job.retriedAt, color: tokens.status.RETRY },
    { label: 'Stalled', at: job.stalledAt, color: tokens.status.STALLED },
    { label: 'Completed', at: job.completedAt, color: tokens.status.COMPLETED },
    { label: 'Failed', at: job.failedAt, color: tokens.status.FAILED },
    { label: 'Cancelled', at: job.cancelledAt, color: tokens.status.CANCELLED },
    { label: 'Expired', at: job.expiredAt, color: tokens.status.EXPIRED },
  ].filter((m) => m.at) as Milestone[];

  // Sort by time so out-of-declaration-order events (e.g. retried before completed) line up.
  milestones.sort(
    (a, b) => new Date(a.at as string).getTime() - new Date(b.at as string).getTime(),
  );

  const items: TimelineItemProps[] = milestones.map((m, i) => {
    const prev = i > 0 ? milestones[i - 1] : undefined;
    return {
      key: `${m.label}-${m.at as string}`,
      color: m.color,
      // Everything in `content`: an item `title` gets its own column on the left in antd's
      // timeline, which pushed the whole timeline off the card's left edge.
      content: (
        <Flex vertical>
          <Typography.Text strong>{m.label}</Typography.Text>
          <Typography.Text type="secondary">
            <Time value={m.at} />
          </Typography.Text>
          {prev && (
            <Typography.Text type="secondary">
              +{duration(prev.at, m.at)} since {prev.label.toLowerCase()}
            </Typography.Text>
          )}
        </Flex>
      ),
    };
  });

  // Never a raw enum: the head reads "Now: Failed", not "Now: FAILED", and honours the stalled
  // pseudo-status the same way the page header does.
  const rawStatus = job.stalled ? STALLED : job.status;

  return (
    <Flex vertical gap="middle">
      <Flex align="center" gap="small">
        <Tag color="processing">Now: {statusLabel(rawStatus)}</Tag>
        <Typography.Text type="secondary">
          Attempt {job.retryAttempt} / {job.retryMaxAttempts}
        </Typography.Text>
      </Flex>
      {items.length ? (
        <Timeline items={items} />
      ) : (
        <Typography.Text type="secondary">No lifecycle events yet.</Typography.Text>
      )}
    </Flex>
  );
}
