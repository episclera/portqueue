/**
 * Overview (home) page: KPI cards, a per-queue table with paused indicator
 * and quick actions, a throughput trend, and a jobs-per-instance breakdown. Polls every 30s.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Col, Popconfirm, Row, Skeleton, Space, Table, Tag, Typography } from 'antd';
import { PauseOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { JobStatus } from '../queries/enums.js';
import { StatusTag, tokens } from '@portqueue/ui';
import type { ColumnsType } from 'antd/es/table';
import type { InstanceDto, QueueDto, StatsDto } from '../../shared/dto.js';
import { api, config } from '../queries/api.js';
import { usePoll } from '../queries/use-poll.js';
import { useAction } from '../queries/use-action.js';
import { KpiCards } from '../components/KpiCards.js';
import { Sparkline } from '../components/Sparkline.js';
import { useStyles } from '../components/styles.js';
import { totalCount } from '../components/format.js';

export function OverviewPage(): React.ReactElement {
  const { styles } = useStyles();
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

  const columns: ColumnsType<QueueDto> = [
    {
      title: 'Queue',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      render: (name: string, row) => (
        <Space>
          <Link to={`/queues/${encodeURIComponent(name)}`}>{name}</Link>
          <Tag color={row.inUse ? 'green' : 'default'}>{row.inUse ? 'in use' : 'unused'}</Tag>
          {row.processingPaused && (
            <Tag color="warning">{row.acceptingPaused ? 'Paused (all)' : 'Paused'}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Total',
      key: 'total',
      responsive: ['sm'],
      render: (_: unknown, r) => totalCount(r.counts),
    },
    ...(
      [JobStatus.ACTIVE, JobStatus.RETRY, JobStatus.FAILED, JobStatus.COMPLETED] as JobStatus[]
    ).map((s): ColumnsType<QueueDto>[number] => ({
      title: <StatusTag status={s} />,
      key: s,
      responsive: ['md'],
      render: (_: unknown, r) => r.counts[s] ?? 0,
    })),
    {
      title: 'Actions',
      key: 'actions',
      fixed: 'right',
      render: (_: unknown, r) =>
        config.readOnly ? (
          <Link to={`/queues/${encodeURIComponent(r.name)}`}>Open</Link>
        ) : r.processingPaused ? (
          <Button
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={() => void run({ kind: 'resume', queue: r.name }, 'Resumed')}
          >
            Resume
          </Button>
        ) : (
          <Popconfirm
            title="Pause processing on this queue?"
            onConfirm={() => void run({ kind: 'pause', queue: r.name }, 'Paused')}
          >
            <Button size="small" icon={<PauseOutlined />}>
              Pause
            </Button>
          </Popconfirm>
        ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div className={styles.hero}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          At a glance
        </Typography.Title>
        <Typography.Text type="secondary">Live queue health across all queues.</Typography.Text>
      </div>

      <KpiCards stats={stats.data} loading={stats.loading} />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card className={styles.card} title="Queues">
            <Table<QueueDto>
              rowKey="name"
              size="middle"
              loading={queues.loading}
              pagination={false}
              scroll={{ x: 'max-content' }}
              columns={columns}
              dataSource={queues.data ?? []}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Card className={styles.card} title="Throughput (jobs/min)">
              {stats.loading && !stats.data ? (
                <Skeleton active />
              ) : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Typography.Title level={2} style={{ margin: 0, color: tokens.color.accent }}>
                    {stats.data ? Math.round(stats.data.throughputPerMinute * 10) / 10 : 0}
                  </Typography.Title>
                  <Sparkline
                    values={history.length > 1 ? history : [0, 0]}
                    width={260}
                    height={48}
                  />
                </Space>
              )}
            </Card>
            <Card
              className={styles.card}
              title="Instances"
              extra={<Link to="/instances">Manage</Link>}
            >
              {instances.loading && !instances.data ? (
                <Skeleton active />
              ) : (
                <InstanceList rows={instances.data ?? []} />
              )}
            </Card>
          </Space>
        </Col>
      </Row>
    </Space>
  );
}

function InstanceList({ rows }: { rows: InstanceDto[] }): React.ReactElement {
  if (!rows.length)
    return (
      <Typography.Text type="secondary">
        No instances registered. Set an <code>instanceKey</code> to enable multi-instance mode.
      </Typography.Text>
    );
  const totals = rows.map((r) => totalCount(r.counts));
  const max = Math.max(...totals, 1);
  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      {rows.slice(0, 8).map((r, i) => (
        <div key={r.instanceKey}>
          <Space style={{ justifyContent: 'space-between', width: '100%' }}>
            <Space size={6}>
              <Tag color={r.alive ? 'green' : 'default'}>{r.alive ? 'alive' : 'stale'}</Tag>
              {r.processingPaused && <Tag color="warning">paused</Tag>}
              <Typography.Text style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                {r.instanceKey}
              </Typography.Text>
            </Space>
            <Typography.Text strong>{totals[i]}</Typography.Text>
          </Space>
          <div
            style={{
              height: 4,
              background: `${tokens.color.accent}22`,
              borderRadius: 4,
              marginTop: 4,
            }}
          >
            <div
              style={{
                height: 4,
                width: `${(totals[i]! / max) * 100}%`,
                background: tokens.color.accent,
                borderRadius: 4,
              }}
            />
          </div>
        </div>
      ))}
    </Space>
  );
}
