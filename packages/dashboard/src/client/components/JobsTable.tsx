/**
 * Reusable jobs table with cursor paging, status filter, row selection + bulk actions.
 * Responsive: on narrow viewports the table horizontally scrolls with a sticky id column.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Popconfirm, Select, Space, Table, Tooltip, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { JobStatus } from '../queries/enums.js';
import { StatusTag } from '@portqueue/ui';
import type { ColumnsType } from 'antd/es/table';
import type { JobDto } from '../../shared/dto.js';
import { config } from '../queries/api.js';
import { relativeTime, truncate } from './format.js';
import { useAction } from '../queries/use-action.js';

export interface JobsTableProps {
  queue: string;
  jobs: JobDto[];
  loading: boolean;
  refetching: boolean;
  statuses: JobStatus[];
  onStatusesChange: (s: JobStatus[]) => void;
  hasMore: boolean;
  onNext: () => void;
  onPrev: () => void;
  canPrev: boolean;
  onRefresh: () => void;
}

export function JobsTable(props: JobsTableProps): React.ReactElement {
  const { run } = useAction();
  const [selected, setSelected] = useState<React.Key[]>([]);
  const readOnly = config.readOnly;

  const columns: ColumnsType<JobDto> = [
    {
      title: 'Job',
      dataIndex: 'id',
      key: 'id',
      fixed: 'left',
      render: (id: string) => (
        <Link to={`/jobs/${encodeURIComponent(id)}`}>
          <Typography.Text style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
            {truncate(id)}
          </Typography.Text>
        </Link>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <StatusTag status={s} />,
    },
    {
      title: 'Attempt',
      dataIndex: 'retryAttempt',
      key: 'attempt',
      responsive: ['md'],
      render: (a: number, r) => `${a}/${r.retryMaxAttempts}`,
    },
    { title: 'Priority', dataIndex: 'priority', key: 'priority', responsive: ['lg'] },
    {
      title: 'Instance',
      key: 'instance',
      responsive: ['lg'],
      render: (_: unknown, r) =>
        r.runOnInstanceId ? (
          <Tooltip title={r.runOnInstanceId}>{truncate(r.runOnInstanceId, 6, 4)}</Tooltip>
        ) : (
          '—'
        ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      responsive: ['sm'],
      render: (v: string) => relativeTime(v),
    },
  ];

  const doBulk = async (kind: 'retry' | 'remove' | 'cancel'): Promise<void> => {
    const jobIds = selected.map(String);
    if (kind === 'remove') {
      await run({ kind: 'remove', queue: props.queue, jobIds }, `Removed ${jobIds.length} job(s)`);
    } else {
      // retry/cancel are per-job in core; fan out.
      for (const jobId of jobIds) await run({ kind, queue: props.queue, jobId });
    }
    setSelected([]);
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
        <Space wrap>
          <Select<JobStatus[]>
            mode="multiple"
            allowClear
            placeholder="Filter by status"
            style={{ minWidth: 220 }}
            value={props.statuses}
            onChange={props.onStatusesChange}
            options={Object.values(JobStatus).map((s) => ({ label: s, value: s }))}
          />
          <Button icon={<ReloadOutlined spin={props.refetching} />} onClick={props.onRefresh}>
            Refresh
          </Button>
        </Space>
        {!readOnly && selected.length > 0 && (
          <Space wrap>
            <Typography.Text type="secondary">{selected.length} selected</Typography.Text>
            <Button size="small" onClick={() => void doBulk('retry')}>
              Retry
            </Button>
            <Button size="small" onClick={() => void doBulk('cancel')}>
              Cancel
            </Button>
            <Popconfirm title="Remove selected jobs?" onConfirm={() => void doBulk('remove')}>
              <Button size="small" danger>
                Remove
              </Button>
            </Popconfirm>
          </Space>
        )}
      </Space>

      <Table<JobDto>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={props.jobs}
        loading={props.loading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        rowSelection={
          readOnly
            ? undefined
            : { selectedRowKeys: selected, onChange: setSelected, preserveSelectedRowKeys: true }
        }
      />

      <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
        <Button disabled={!props.canPrev} onClick={props.onPrev}>
          Previous
        </Button>
        <Button disabled={!props.hasMore} onClick={props.onNext}>
          Next
        </Button>
      </Space>
    </Space>
  );
}
