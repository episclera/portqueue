/** KPI stat cards row for the Overview / Queue-detail pages. */
import React from 'react';
import styled from 'styled-components';
import { Card, Col, Row, SkeletonText, Statistic, tokens } from '@portqueue/ui';
import { JobStatus } from '../queries/enums';
import type { StatsDto } from '../../shared/dto';

export interface KpiCardsProps {
  stats: StatsDto | undefined;
  loading: boolean;
}

const KPI_STATUSES: JobStatus[] = [
  JobStatus.ACTIVE,
  JobStatus.RETRY,
  JobStatus.FAILED,
  JobStatus.COMPLETED,
];

/** Colours a Statistic's value with an arbitrary status colour (tone can't carry a hex). */
const ColoredStat = styled.div<{ $color?: string }>`
  ${(p) => (p.$color ? `& > div > div:last-child { color: ${p.$color}; }` : '')}
`;

export function KpiCards({ stats, loading }: KpiCardsProps): React.ReactElement {
  const counts = stats?.counts ?? {};

  const items: { label: string; value: React.ReactNode; color?: string }[] = [
    ...KPI_STATUSES.map((s) => ({
      label: s,
      value: counts[s] ?? 0,
      color: tokens.color.status[s],
    })),
    {
      label: 'Stalled',
      value: counts.STALLED ?? 0,
      color: tokens.color.status.STALLED,
    },
    {
      label: 'Jobs / min',
      value: stats ? Math.round(stats.throughputPerMinute * 10) / 10 : 0,
    },
    {
      label: 'Failure rate',
      value: stats ? `${Math.round(stats.failureRate * 1000) / 10}%` : '0%',
    },
  ];

  return (
    <Row gutter={16}>
      {items.map((item) => (
        <Col key={item.label} span={3} flex="auto">
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
