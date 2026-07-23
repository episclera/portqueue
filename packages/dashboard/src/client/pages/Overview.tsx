/**
 * Overview (home) page: KPI cards, a per-queue table with paused indicator
 * and quick actions, a throughput trend, and a jobs-per-instance breakdown. Polls every 30s.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import {
  Button,
  Card,
  Code,
  Col,
  Inline,
  Popconfirm,
  Row,
  SkeletonText,
  Stack,
  StatusTag,
  Table,
  Tag,
  Text,
  Title,
  tokens,
} from '@portqueue/ui';
import type { TableColumn } from '@portqueue/ui';
import { JobStatus } from '../queries/enums.js';
import type { InstanceDto, QueueDto, StatsDto } from '../../shared/dto.js';
import { api, config } from '../queries/api.js';
import { usePoll } from '../queries/use-poll.js';
import { useAction } from '../queries/use-action.js';
import { KpiCards } from '../components/KpiCards.js';
import { Sparkline } from '../components/Sparkline.js';
import { totalCount } from '../components/format.js';

const Hero = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Mono = styled.span`
  font-family: ${(p) => p.theme.font.mono};
  font-size: 12px;
`;

const Bar = styled.div`
  height: 4px;
  border-radius: 4px;
  margin-top: 4px;
  background: ${tokens.color.accent}22;
`;

const BarFill = styled.div<{ $pct: number }>`
  height: 4px;
  border-radius: 4px;
  width: ${(p) => p.$pct}%;
  background: ${tokens.color.accent};
`;

export function OverviewPage(): React.ReactElement {
  const { run } = useAction();

  const stats = usePoll<StatsDto>(() => api.getStats(), []);
  const queues = usePoll<QueueDto[]>(() => api.getQueues(), []);
  const instances = usePoll<InstanceDto[]>(() => api.getInstances(), []);

  // Client-side throughput history for the trend (server exposes a scalar; we sample it).
  const [history, setHistory] = useState<number[]>([]);
  const lastTp = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (stats.data && stats.data.throughputPerMinute !== lastTp.current) {
      lastTp.current = stats.data.throughputPerMinute;
      setHistory((h) => [...h.slice(-23), stats.data!.throughputPerMinute]);
    }
  }, [stats.data]);

  const columns: TableColumn<QueueDto>[] = [
    {
      title: 'Queue',
      key: 'name',
      render: (row) => (
        <Inline gap={2} align="center">
          <Link to={`/queues/${encodeURIComponent(row.name)}`}>{row.name}</Link>
          <Tag tone={row.inUse ? 'success' : 'neutral'}>{row.inUse ? 'in use' : 'unused'}</Tag>
          {row.processingPaused && (
            <Tag tone="warning">{row.acceptingPaused ? 'Paused (all)' : 'Paused'}</Tag>
          )}
        </Inline>
      ),
    },
    {
      title: 'Total',
      key: 'total',
      render: (r) => totalCount(r.counts),
    },
    ...([JobStatus.ACTIVE, JobStatus.RETRY, JobStatus.FAILED, JobStatus.COMPLETED] as JobStatus[]).map(
      (s): TableColumn<QueueDto> => ({
        title: <StatusTag status={s} />,
        key: s,
        render: (r) => r.counts[s] ?? 0,
      }),
    ),
    {
      title: 'Actions',
      key: 'actions',
      render: (r) =>
        config.readOnly ? (
          <Link to={`/queues/${encodeURIComponent(r.name)}`}>Open</Link>
        ) : r.processingPaused ? (
          <Button
            size="sm"
            icon="▶️"
            onClick={() => void run({ kind: 'resume', queue: r.name }, 'Resumed')}
          >
            Resume
          </Button>
        ) : (
          <Popconfirm
            title="Pause processing on this queue?"
            onConfirm={() => void run({ kind: 'pause', queue: r.name }, 'Paused')}
          >
            <Button size="sm" icon="⏸️">
              Pause
            </Button>
          </Popconfirm>
        ),
    },
  ];

  return (
    <Stack gap={4}>
      <Hero>
        <Title level={3}>At a glance</Title>
        <Text $tone="muted">Live queue health across all queues.</Text>
      </Hero>

      <KpiCards stats={stats.data} loading={stats.loading} />

      <Row gutter={16}>
        <Col span={16}>
          <Card title="Queues" bodyPadding={false}>
            {queues.loading && !queues.data ? (
              <div style={{ padding: 16 }}>
                <SkeletonText rows={4} />
              </div>
            ) : (
              <Table<QueueDto>
                rowKey={(r) => r.name}
                size="md"
                columns={columns}
                data={queues.data ?? []}
              />
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Stack gap={4}>
            <Card title="Throughput (jobs/min)">
              {stats.loading && !stats.data ? (
                <SkeletonText rows={3} />
              ) : (
                <Stack gap={3}>
                  <Title level={2} style={{ color: tokens.color.accent }}>
                    {stats.data ? Math.round(stats.data.throughputPerMinute * 10) / 10 : 0}
                  </Title>
                  <Sparkline
                    values={history.length > 1 ? history : [0, 0]}
                    width={260}
                    height={48}
                  />
                </Stack>
              )}
            </Card>
            <Card title="Instances" extra={<Link to="/instances">Manage</Link>}>
              {instances.loading && !instances.data ? (
                <SkeletonText rows={3} />
              ) : (
                <InstanceList rows={instances.data ?? []} />
              )}
            </Card>
          </Stack>
        </Col>
      </Row>
    </Stack>
  );
}

function InstanceList({ rows }: { rows: InstanceDto[] }): React.ReactElement {
  if (!rows.length)
    return (
      <Text $tone="muted">
        No instances registered. Set an <Code>instanceKey</Code> to enable multi-instance mode.
      </Text>
    );
  const totals = rows.map((r) => totalCount(r.counts));
  const max = Math.max(...totals, 1);
  return (
    <Stack gap={2}>
      {rows.slice(0, 8).map((r, i) => {
        const total = totals[i] ?? 0;
        return (
          <div key={r.instanceKey}>
            <Inline justify="space-between" align="center">
              <Inline gap={2} align="center">
                <Tag tone={r.alive ? 'success' : 'neutral'}>{r.alive ? 'alive' : 'stale'}</Tag>
                {r.processingPaused && <Tag tone="warning">paused</Tag>}
                <Mono>{r.instanceKey}</Mono>
              </Inline>
              <Text $strong>{total}</Text>
            </Inline>
            <Bar>
              <BarFill $pct={(total / max) * 100} />
            </Bar>
          </div>
        );
      })}
    </Stack>
  );
}
