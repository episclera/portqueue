/**
 * Job lifecycle timeline: a compact vertical timeline from the job's lifecycle timestamps,
 * showing the current status at the head and the duration between transitions. Renders for
 * every job (single-function or multi-step).
 */
import React from 'react';
import { Tag, Text, Timeline, tokens } from '@portqueue/ui';
import type { TimelineItem } from '@portqueue/ui';
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

  const items: TimelineItem[] = milestones.map((m, i) => {
    const prev = i > 0 ? milestones[i - 1] : undefined;
    return {
      key: `${m.label}-${m.at as string}`,
      color: m.color,
      label: <Time value={m.at} />,
      children: (
        <div>
          <Text strong>{m.label}</Text>
          {prev && (
            <div>
              <Text tone="muted" small>
                +{duration(prev.at, m.at)} since {prev.label.toLowerCase()}
              </Text>
            </div>
          )}
        </div>
      ),
    };
  });

  // Never a raw enum: the head reads "Now: Failed", not "Now: FAILED", and honours the stalled
  // pseudo-status the same way the page header does.
  const rawStatus = job.stalled ? STALLED : job.status;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Tag tone="info">Now: {statusLabel(rawStatus)}</Tag>{' '}
        <Text tone="muted">
          Attempt {job.retryAttempt} / {job.retryMaxAttempts}
        </Text>
      </div>
      {items.length ? (
        <Timeline items={items} />
      ) : (
        <Text tone="muted">No lifecycle events yet.</Text>
      )}
    </div>
  );
}
