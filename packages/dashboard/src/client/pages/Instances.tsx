/**
 * Instances page: every registered instance with liveness, per-instance job
 * attribution, and per-instance pause/resume. Only populated when instances run in
 * multi-instance mode (an `instanceKey` on the PortQueue). Polls every 30s.
 */
import React from 'react';
import { Button, Card, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, PauseOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { JobStatus } from '../queries/enums.js';
import { StatusTag } from '@portqueue/ui';
import type { ColumnsType } from 'antd/es/table';
import type { InstanceDto } from '../../shared/dto.js';
import { api, config } from '../queries/api.js';
import { usePoll } from '../queries/use-poll.js';
import { useAction } from '../queries/use-action.js';
import { useStyles } from '../components/styles.js';
import { totalCount, formatDate } from '../components/format.js';

export function InstancesPage(): React.ReactElement {
  const { styles } = useStyles();
  const { run } = useAction();
  const instances = usePoll<InstanceDto[]>(() => api.getInstances(), []);

  const columns: ColumnsType<InstanceDto> = [
    {
      title: 'Instance',
      dataIndex: 'instanceKey',
      key: 'instanceKey',
      fixed: 'left',
      render: (key: string, r) => (
        <Space>
          <Typography.Text style={{ fontFamily: 'ui-monospace, monospace' }}>{key}</Typography.Text>
          <Tag color={r.alive ? 'green' : 'default'}>{r.alive ? 'alive' : 'stale'}</Tag>
          {r.processingPaused && <Tag color="warning">paused</Tag>}
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
    ).map((s): ColumnsType<InstanceDto>[number] => ({
      title: <StatusTag status={s} />,
      key: s,
      responsive: ['md'],
      render: (_: unknown, r) => r.counts[s] ?? 0,
    })),
    {
      title: 'Last seen',
      dataIndex: 'lastSeenAt',
      key: 'lastSeenAt',
      responsive: ['lg'],
      render: (v: string) => <Tooltip title={formatDate(v)}>{formatDate(v)}</Tooltip>,
    },
    {
      title: 'Actions',
      key: 'actions',
      fixed: 'right',
      render: (_: unknown, r) => {
        if (config.readOnly) return null;
        // Match the core rule: an instance may only be removed after 30 minutes unseen.
        const removable = Date.now() - new Date(r.lastSeenAt).getTime() > 30 * 60 * 1000;
        return (
          <Space>
            {r.processingPaused ? (
              <Button
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={() =>
                  void run({ kind: 'resumeInstance', instanceKey: r.instanceKey }, 'Resumed')
                }
              >
                Resume
              </Button>
            ) : (
              <Popconfirm
                title="Pause job processing on this instance?"
                onConfirm={() =>
                  void run({ kind: 'pauseInstance', instanceKey: r.instanceKey }, 'Paused')
                }
              >
                <Button size="small" icon={<PauseOutlined />}>
                  Pause
                </Button>
              </Popconfirm>
            )}
            {removable && (
              <Popconfirm
                title="Remove this inactive instance from monitoring?"
                description="Only tidies the instances list; job history is untouched."
                onConfirm={() =>
                  void run({ kind: 'removeInstance', instanceKey: r.instanceKey }, 'Instance removed')
                }
              >
                <Button size="small" danger icon={<DeleteOutlined />}>
                  Remove
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div className={styles.hero}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Instances
        </Typography.Title>
        <Typography.Text type="secondary">
          Liveness and per-instance job attribution across the cluster.
        </Typography.Text>
      </div>

      <Card className={styles.card} title="Registered instances">
        <Table<InstanceDto>
          rowKey="instanceKey"
          size="middle"
          loading={instances.loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          columns={columns}
          dataSource={instances.data ?? []}
          locale={{
            emptyText:
              'No instances registered. Set an `instanceKey` on the PortQueue to enable multi-instance mode.',
          }}
        />
      </Card>
    </Space>
  );
}
