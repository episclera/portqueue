/** Activity cards — one per job state, for the Overview and Queue-detail pages. */
import React from 'react';
import { Card, Col, Row, SkeletonText, Statistic, tokens } from '@portqueue/ui';
import type { StatsDto } from '../../shared/dto';
import { CARD_STATUSES, STATUSES_CONFIG } from '../constants/labels';
import { ErrorState } from './states';

export interface KpiCardsProps {
  stats: StatsDto | undefined;
  loading: boolean;
  /** Set when the stats query failed; the row is replaced by an error notice. */
  error?: unknown;
  onRetry?: () => void;
}

/**
 * One card per {@link CARD_STATUSES} entry, on one row. `span` is the sizing model — `Col` treats
 * `flex` as an override, so passing both (as this once did) left the span inert. Four cards divide
 * the 24 columns exactly: 4×6 = 24, a full row with no gap at the end.
 *
 * Every card is a status the database actually groups by. There is no stalled card: stalling is
 * derived per row from the lock deadline, never counted, so a card here could only ever have shown
 * a number no read produces.
 */
const CARD_SPAN = 6;

export function KpiCards({ stats, loading, error, onRetry }: KpiCardsProps): React.ReactElement {
  const counts = stats?.counts ?? {};

  const items: { label: string; value: React.ReactNode; color?: string }[] = CARD_STATUSES.map(
    (s) => ({
      label: STATUSES_CONFIG[s].label,
      value: counts[s] ?? 0,
      color: tokens.color.status[s],
    }),
  );

  // These are the page's headline numbers; rendering zeros for a failed fetch would read as
  // "the queue is idle", which is the opposite of "we don't know".
  if (error) {
    return (
      <ErrorState title="Could not load activity" error={error} {...(onRetry ? { onRetry } : {})} />
    );
  }

  return (
    <Row gutter={16}>
      {items.map((item) => (
        <Col key={item.label} span={CARD_SPAN}>
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
