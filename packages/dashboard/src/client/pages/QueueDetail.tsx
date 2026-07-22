/**
 * Queue detail page: scoped KPI cards, a filterable/paginated jobs table,
 * pause/resume (with PauseMode choice), add-a-job, purge-by-state, and a schedules panel.
 */
import React, { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, Dropdown, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { DownOutlined, PauseOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { JobStatus, PauseMode } from '../queries/enums.js';
import type { JobPageDto, QueueDto, StatsDto } from '../../shared/dto.js';
import { api, config } from '../queries/api.js';
import { usePoll, useQuery } from '../queries/use-poll.js';
import { useAction } from '../queries/use-action.js';
import { KpiCards } from '../components/KpiCards.js';
import { JobsTable } from '../components/JobsTable.js';
import { AddJobForm } from '../components/AddJobForm.js';
import { useStyles } from '../components/styles.js';
import { SchedulesPanel } from '../components/SchedulesPanel.js';

export function QueueDetailPage(): React.ReactElement {
  const { name } = useParams<{ name: string }>();
  const queue = decodeURIComponent(name);
  const { styles } = useStyles();
  const { run } = useAction();

  const stats = usePoll<StatsDto>(() => api.getStats(queue), [queue]);
  const queues = usePoll<QueueDto[]>(() => api.getQueues(), []);
  const info = useMemo(() => queues.data?.find((q) => q.name === queue), [queues.data, queue]);

  const [statuses, setStatuses] = useState<JobStatus[]>([]);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const cursor = cursorStack[cursorStack.length - 1];

  const jobs = usePoll<JobPageDto>(
    () =>
      api.getJobs({
        queue,
        statuses: statuses.length ? statuses.join(',') : undefined,
        cursor,
        limit: '25',
        order: 'desc',
      }),
    [queue, statuses.join(','), cursor],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [purgeStatuses, setPurgeStatuses] = useState<JobStatus[]>([JobStatus.COMPLETED]);

  const pauseMenu = {
    items: [
      { key: PauseMode.PROCESSING, label: 'Pause processing (still accepts jobs)' },
      { key: PauseMode.ALL, label: 'Pause all (also refuse new jobs)' },
    ],
    onClick: ({ key }: { key: string }) =>
      void run({ kind: 'pause', queue, mode: key as PauseMode }, 'Paused'),
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
        <Space align="center">
          <Typography.Title level={3} style={{ margin: 0 }}>
            {queue}
          </Typography.Title>
          {info?.processingPaused && (
            <Tag color="warning">{info.acceptingPaused ? 'Paused (all)' : 'Paused'}</Tag>
          )}
        </Space>
        {!config.readOnly && (
          <Space wrap>
            {info?.processingPaused ? (
              <Button
                icon={<PlayCircleOutlined />}
                onClick={() => void run({ kind: 'resume', queue }, 'Resumed')}
              >
                Resume
              </Button>
            ) : (
              <Dropdown menu={pauseMenu}>
                <Button icon={<PauseOutlined />}>
                  Pause <DownOutlined />
                </Button>
              </Dropdown>
            )}
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
              Add job
            </Button>
          </Space>
        )}
      </Space>

      <KpiCards stats={stats.data} loading={stats.loading} />

      <Card className={styles.card} title="Jobs">
        <JobsTable
          queue={queue}
          jobs={jobs.data?.items ?? []}
          loading={jobs.loading}
          refetching={jobs.refetching}
          statuses={statuses}
          onStatusesChange={(s) => {
            setStatuses(s);
            setCursorStack([]);
          }}
          hasMore={jobs.data?.hasMore ?? false}
          onNext={() =>
            jobs.data?.cursor && setCursorStack((s) => [...s, jobs.data!.cursor as string])
          }
          onPrev={() => setCursorStack((s) => s.slice(0, -1))}
          canPrev={cursorStack.length > 0}
          onRefresh={jobs.refetch}
        />
      </Card>

      {!config.readOnly && (
        <Card className={styles.card} title="Purge by state" size="small">
          <Space wrap>
            <Select<JobStatus[]>
              mode="multiple"
              style={{ minWidth: 260 }}
              value={purgeStatuses}
              onChange={setPurgeStatuses}
              options={Object.values(JobStatus).map((s) => ({ label: s, value: s }))}
            />
            <Popconfirm
              title={`Permanently delete all jobs in ${purgeStatuses.join(', ') || '—'}?`}
              onConfirm={() =>
                void run({ kind: 'purge', queue, statuses: purgeStatuses }, 'Purged')
              }
            >
              <Button danger disabled={!purgeStatuses.length}>
                Purge
              </Button>
            </Popconfirm>
          </Space>
        </Card>
      )}

      <SchedulesQueuePanel queue={queue} />

      <AddJobForm open={addOpen} queue={queue} onClose={() => setAddOpen(false)} />
    </Space>
  );
}

/** Schedules scoped to this queue. */
function SchedulesQueuePanel({ queue }: { queue: string }): React.ReactElement {
  const { styles } = useStyles();
  const schedules = useQuery(() => api.getSchedules(queue), [queue]);
  return (
    <Card className={styles.card} title="Schedules">
      <SchedulesPanel
        rows={schedules.data ?? []}
        loading={schedules.loading}
        onChanged={schedules.refetch}
        showQueueColumn={false}
      />
    </Card>
  );
}
