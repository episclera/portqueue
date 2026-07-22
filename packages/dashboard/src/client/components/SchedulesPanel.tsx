/** Reusable schedules table with next-run, timezone, and remove (unschedule) action. */
import React from 'react';
import { Link } from 'react-router-dom';
import { Button, Popconfirm, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ScheduleDto } from '../../shared/dto.js';
import { config } from '../queries/api.js';
import { useAction } from '../queries/use-action.js';
import { formatDate, relativeTime } from './format.js';

export interface SchedulesPanelProps {
  rows: ScheduleDto[];
  loading: boolean;
  onChanged: () => void;
  showQueueColumn?: boolean;
}

export function SchedulesPanel({
  rows,
  loading,
  onChanged,
  showQueueColumn = true,
}: SchedulesPanelProps): React.ReactElement {
  const { run } = useAction();

  const columns: ColumnsType<ScheduleDto> = [
    { title: 'Key', dataIndex: 'key', key: 'key', fixed: 'left' },
    ...(showQueueColumn
      ? [
          {
            title: 'Queue',
            dataIndex: 'queue',
            key: 'queue',
            render: (q: string) => <Link to={`/queues/${encodeURIComponent(q)}`}>{q}</Link>,
          } as ColumnsType<ScheduleDto>[number],
        ]
      : []),
    {
      title: 'Cadence',
      key: 'cadence',
      render: (_: unknown, r) =>
        r.cron ? <code>{r.cron}</code> : r.every ? `every ${Math.round(r.every / 1000)}s` : '—',
    },
    {
      title: 'Timezone',
      dataIndex: 'timezone',
      key: 'timezone',
      responsive: ['md'],
      render: (v?: string | null) => v ?? 'UTC',
    },
    {
      title: 'Next run',
      dataIndex: 'nextRunAt',
      key: 'nextRunAt',
      render: (v?: string | null) => (v ? relativeTime(v) : '—'),
    },
    {
      title: 'Last run',
      dataIndex: 'lastRunAt',
      key: 'lastRunAt',
      responsive: ['lg'],
      render: (v?: string | null) => formatDate(v),
    },
    {
      title: 'State',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (enabled: boolean) => (
        <Tag color={enabled ? 'green' : 'default'}>{enabled ? 'Enabled' : 'Disabled'}</Tag>
      ),
    },
    ...(config.readOnly
      ? []
      : [
          {
            title: '',
            key: 'actions',
            fixed: 'right',
            render: (_: unknown, r: ScheduleDto) => (
              <Popconfirm
                title="Remove this schedule?"
                onConfirm={async () => {
                  await run(
                    { kind: 'removeSchedule', queue: r.queue, scheduleId: r.scheduleId },
                    'Schedule removed',
                  );
                  onChanged();
                }}
              >
                <Button size="small" danger>
                  Remove
                </Button>
              </Popconfirm>
            ),
          } as ColumnsType<ScheduleDto>[number],
        ]),
  ];

  if (!loading && rows.length === 0) {
    return <Typography.Text type="secondary">No recurring schedules.</Typography.Text>;
  }

  return (
    <Table<ScheduleDto>
      rowKey="scheduleId"
      size="middle"
      loading={loading}
      pagination={false}
      scroll={{ x: 'max-content' }}
      columns={columns}
      dataSource={rows}
    />
  );
}
