/**
 * Queue detail page: scoped KPI cards, a filterable/paginated jobs table,
 * pause/resume (with PauseMode choice), add-a-job, purge-by-state, and a schedules panel.
 */
import React, { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Dropdown,
  Inline,
  PageHeader,
  Popconfirm,
  Select,
  Stack,
  Tag,
} from '@portqueue/ui';
import type { DropdownItem } from '@portqueue/ui';
import { JobStatus, PauseMode } from '../queries/enums';
import type { JobPageDto, QueueDto, StatsDto } from '../../shared/dto';
import { api, config } from '../queries/api';
import { usePoll, useQuery } from '../queries/use-poll';
import { useAction } from '../queries/use-action';
import { KpiCards } from '../components/KpiCards';
import { JobsTable } from '../components/JobsTable';
import { AddJobForm } from '../components/AddJobForm';
import { SchedulesPanel } from '../components/SchedulesPanel';

export function QueueDetailPage(): React.ReactElement {
  const { name } = useParams<{ name: string }>();
  const queue = decodeURIComponent(name);
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
  const [purgePick, setPurgePick] = useState<JobStatus | undefined>(undefined);

  const pauseItems: DropdownItem[] = [
    {
      key: PauseMode.PROCESSING,
      label: 'Pause processing (still accepts jobs)',
      onClick: () => void run({ kind: 'pause', queue, mode: PauseMode.PROCESSING }, 'Paused'),
    },
    {
      key: PauseMode.ALL,
      label: 'Pause all (also refuse new jobs)',
      onClick: () => void run({ kind: 'pause', queue, mode: PauseMode.ALL }, 'Paused'),
    },
  ];

  const titleTags = (
    <Inline gap={2} align="center">
      {info && <Tag tone={info.inUse ? 'success' : 'neutral'}>{info.inUse ? 'in use' : 'unused'}</Tag>}
      {info?.processingPaused && (
        <Tag tone="warning">{info.acceptingPaused ? 'Paused (all)' : 'Paused'}</Tag>
      )}
    </Inline>
  );

  const actions = !config.readOnly ? (
    <Inline gap={2} align="center" wrap>
      {info?.processingPaused ? (
        <Button icon="▶️" onClick={() => void run({ kind: 'resume', queue }, 'Resumed')}>
          Resume
        </Button>
      ) : (
        <Dropdown items={pauseItems}>
          <Button icon="⏸️">
            Pause <span aria-hidden>▾</span>
          </Button>
        </Dropdown>
      )}
      <Button variant="primary" icon="➕" onClick={() => setAddOpen(true)}>
        Add job
      </Button>
      {info && !info.inUse && (
        <Popconfirm
          title="Remove this queue from the database?"
          description="Only allowed because no running process declares it. Job rows are untouched."
          okDanger
          onConfirm={() => void run({ kind: 'removeQueue', queue }, 'Queue removed')}
        >
          <Button variant="danger" icon="🗑️">
            Remove queue
          </Button>
        </Popconfirm>
      )}
    </Inline>
  ) : undefined;

  return (
    <Stack gap={4}>
      <PageHeader title={<Inline gap={2} align="center">{queue}{titleTags}</Inline>} extra={actions} />

      <KpiCards stats={stats.data} loading={stats.loading} />

      <Card title="Jobs" bodyPadding={false}>
        <div style={{ padding: 16 }}>
          <JobsTable
            queue={queue}
            jobs={jobs.data?.items ?? []}
            loading={jobs.loading}
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
        </div>
      </Card>

      {!config.readOnly && (
        <Card title="Purge by state">
          <Inline gap={2} align="center" wrap>
            <Select<JobStatus>
              placeholder="Add a state to purge…"
              value={purgePick}
              onChange={(s) => {
                setPurgeStatuses((prev) => (prev.includes(s) ? prev : [...prev, s]));
                setPurgePick(undefined);
              }}
              options={Object.values(JobStatus).map((s) => ({ label: s, value: s }))}
            />
            <Inline gap={1} align="center" wrap>
              {purgeStatuses.map((s) => (
                <Tag
                  key={s}
                  tone="info"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setPurgeStatuses((prev) => prev.filter((x) => x !== s))}
                >
                  {s} ✕
                </Tag>
              ))}
            </Inline>
            <Popconfirm
              title={`Permanently delete all jobs in ${purgeStatuses.join(', ') || '—'}?`}
              okDanger
              onConfirm={() => void run({ kind: 'purge', queue, statuses: purgeStatuses }, 'Purged')}
            >
              <Button variant="danger" disabled={!purgeStatuses.length}>
                Purge
              </Button>
            </Popconfirm>
          </Inline>
        </Card>
      )}

      <SchedulesQueuePanel queue={queue} />

      <AddJobForm open={addOpen} queue={queue} onClose={() => setAddOpen(false)} />
    </Stack>
  );
}

/** Schedules scoped to this queue. */
function SchedulesQueuePanel({ queue }: { queue: string }): React.ReactElement {
  const schedules = useQuery(() => api.getSchedules(queue), [queue]);
  return (
    <Card title="Schedules" bodyPadding={false}>
      <div style={{ padding: 16 }}>
        <SchedulesPanel
          rows={schedules.data ?? []}
          loading={schedules.loading}
          onChanged={schedules.refetch}
          showQueueColumn={false}
        />
      </div>
    </Card>
  );
}
