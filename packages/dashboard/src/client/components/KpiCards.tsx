/** Activity cards — one per job state, for the Overview and Queue-detail pages. */
import React from 'react';
import styled from 'styled-components';
import { Card, Col, Row, SkeletonText, Statistic, tokens } from '@portqueue/ui';
import type { StatsDto } from '../../shared/dto';
import { COUNT_STATUSES, STALLED, STALLED_LABEL, STATUSES_CONFIG } from '../constants/labels';

export interface KpiCardsProps {
  stats: StatsDto | undefined;
  loading: boolean;
}

/** Colours a Statistic's value with an arbitrary status colour (tone can't carry a hex). */
const ColoredStat = styled.div<{ $color?: string }>`
  ${(p) => (p.$color ? `& > div > div:last-child { color: ${p.$color}; }` : '')}
`;

export function KpiCards({ stats, loading }: KpiCardsProps): React.ReactElement {
  const counts = stats?.counts ?? {};

  const items: { label: string; value: React.ReactNode; color?: string }[] = [
    ...COUNT_STATUSES.map((s) => ({
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

  return (
    <Row gutter={16}>
      {items.map((item) => (
        <Col key={item.label} span={4} flex="auto">
          <Card>
            {loading && !stats ? (
              <SkeletonText rows={2} width="60%" />
            ) : (
              <ColoredStat $color={item.color}>
                <Statistic label={item.label} value={item.value} />
              </ColoredStat>
            )}
          </Card>
        </Col>
      ))}
    </Row>
  );
}
