/** Reusable schedules table with next-run, timezone, and remove (unschedule) action. */
import React from 'react';
import { Link } from 'react-router-dom';
import { Button, Code, Popconfirm, SkeletonText, Tag, Text, Table } from '@portqueue/ui';
import type { TableColumn } from '@portqueue/ui';
import type { ScheduleDto } from '../../shared/dto';
import { config } from '../queries/api';
import { useAction } from '../queries/use-action';
import { formatDate, relativeTime } from './format';

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

  const columns: TableColumn<ScheduleDto>[] = [
    ...(showQueueColumn
      ? [
          {
            title: 'Queue',
            dataIndex: 'queue',
            key: 'queue',
            render: (r: ScheduleDto) => (
              <Link to={`/queues/${encodeURIComponent(r.queue)}`}>{r.queue}</Link>
            ),
          } satisfies TableColumn<ScheduleDto>,
        ]
      : []),
    {
      title: 'Cadence',
      key: 'cadence',
      render: (r) =>
        r.cron ? <Code>{r.cron}</Code> : r.every ? `every ${Math.round(r.every / 1000)}s` : '—',
    },
    {
      title: 'Timezone',
      dataIndex: 'timezone',
      key: 'timezone',
      render: (r) => r.timezone ?? 'UTC',
    },
    {
      title: 'Next run',
      dataIndex: 'nextRunAt',
      key: 'nextRunAt',
      render: (r) => (r.nextRunAt ? relativeTime(r.nextRunAt) : '—'),
    },
    {
      title: 'Last run',
      dataIndex: 'lastRunAt',
      key: 'lastRunAt',
      render: (r) => formatDate(r.lastRunAt),
    },
    {
      title: 'State',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (r) => (
        <Tag tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'Enabled' : 'Disabled'}</Tag>
      ),
    },
    ...(config.readOnly
      ? []
      : [
          {
            title: '',
            key: 'actions',
            align: 'right',
            render: (r: ScheduleDto) => (
              <Popconfirm
                title="Remove this schedule?"
                okText="Remove"
                okDanger
                onConfirm={() => {
                  void (async (): Promise<void> => {
                    await run(
                      { kind: 'removeSchedule', queue: r.queue, scheduleId: r.scheduleId },
                      'Schedule removed',
                    );
                    onChanged();
                  })();
                }}
              >
                <Button size="sm" variant="danger">
                  Remove
                </Button>
              </Popconfirm>
            ),
          } satisfies TableColumn<ScheduleDto>,
        ]),
  ];

  if (loading) {
    return <SkeletonText rows={4} />;
  }

  if (rows.length === 0) {
    return <Text $tone="muted">No recurring schedules.</Text>;
  }

  return (
    <Table<ScheduleDto>
      rowKey={(r) => r.scheduleId}
      size="md"
      columns={columns}
      data={rows}
    />
  );
}
