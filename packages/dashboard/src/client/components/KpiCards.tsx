/** Activity cards — one per job state, for the Overview and Queue-detail pages. */
import React from 'react';
import { Card, Col, Row, SkeletonText, Statistic, tokens } from '@portqueue/ui';
import type { StatsDto } from '../../shared/dto';
import { CARD_STATUSES, STALLED, STALLED_LABEL, STATUSES_CONFIG } from '../constants/labels';
import { ErrorState } from './states';

export interface KpiCardsProps {
  stats: StatsDto | undefined;
  loading: boolean;
  /** Set when the stats query failed; the row is replaced by an error notice. */
  error?: unknown;
  onRetry?: () => void;
}

/**
 * Five cards on one row. `span` is the sizing model — `Col` treats `flex` as an override, so
 * passing both (as this once did) left the span inert. 24 columns don't divide by five, so the
 * last card takes the remainder: 5×4 + 4 = 24, a full row with no gap at the end.
 */
const CARD_SPAN = 5;
const LAST_CARD_SPAN = 4;

export function KpiCards({ stats, loading, error, onRetry }: KpiCardsProps): React.ReactElement {
  const counts = stats?.counts ?? {};

  const items: { label: string; value: React.ReactNode; color?: string }[] = [
    ...CARD_STATUSES.map((s) => ({
      label: STATUSES_CONFIG[s].label,
      value: counts[s] ?? 0,
      color: tokens.color.status[s],
    })),
    {
      label: STALLED_LABEL,
      value: counts[STALLED] ?? 0,
      color: tokens.color.status.STALLED,
    },
  ];

  // These are the page's headline numbers; rendering zeros for a failed fetch would read as
  // "the queue is idle", which is the opposite of "we don't know".
  if (error) {
    return (
      <ErrorState title="Could not load activity" error={error} {...(onRetry ? { onRetry } : {})} />
    );
  }

  return (
    <Row gutter={16}>
      {items.map((item, i) => (
        <Col key={item.label} span={i === items.length - 1 ? LAST_CARD_SPAN : CARD_SPAN}>
          <Card>
            {loading && !stats ? (
              <SkeletonText rows={2} width="60%" />
            ) : (
              <Statistic label={item.label} value={item.value} valueColor={item.color} />
            )}
          </Card>
        </Col>
      ))}
    </Row>
  );
}
