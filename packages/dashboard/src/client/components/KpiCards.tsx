/** KPI stat cards row for the Overview / Queue-detail pages. */
import React from 'react';
import { Card, Col, Row, Skeleton, Statistic } from 'antd';
import { JobStatus } from '../queries/enums.js';
import { tokens } from '@portqueue/ui';
import type { StatsDto } from '../../shared/dto.js';
import { useStyles } from './styles.js';

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

export function KpiCards({ stats, loading }: KpiCardsProps): React.ReactElement {
  const { styles } = useStyles();
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
    <Row gutter={[16, 16]}>
      {items.map((item) => (
        <Col key={item.label} xs={12} sm={8} md={6} xl={3} flex="auto">
          <Card className={styles.card} styles={{ body: { padding: 18 } }}>
            {loading && !stats ? (
              <Skeleton active paragraph={false} title={{ width: '60%' }} />
            ) : (
              <Statistic
                title={<span className={styles.kpiLabel}>{item.label}</span>}
                value={item.value as string | number}
                valueStyle={{ color: item.color, fontWeight: 700, fontSize: 26 }}
              />
            )}
          </Card>
        </Col>
      ))}
    </Row>
  );
}
