/**
 * Queue detail page: the queue's activity cards and its jobs table. Pause / resume, add-a-job
 * and remove-queue live in the page's subheader band.
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Content, Dropdown, Inline, PageHeader, Popconfirm, Stack } from '@portqueue/ui';
import type { DropdownItem } from '@portqueue/ui';
import { PauseMode } from '../queries/enums';
import { ActionKind, type QueuePageDto, type StatsDto } from '../../shared/dto';
import { api } from '../queries/api';
import { queryKeys, usePolledQuery } from '../queries/use-queries';
import { useAction } from '../queries/use-action';
import {
  ACTIONS_CONFIG,
  PAUSE_MODES_CONFIG,
  QUEUE_USAGE_CONFIG,
  pauseStateLabel,
} from '../constants/labels';
import { KpiCards } from '../components/KpiCards';
import { JobsTable } from '../components/JobsTable';
import { AddJobForm } from '../components/AddJobForm';

export function QueueDetailPage(): React.ReactElement {
  const { name } = useParams<{ name: string }>();
  const queue = decodeURIComponent(name);
  const { run } = useAction();

  const stats = usePolledQuery<StatsDto>(queryKeys.stats(queue), () => api.getStats(queue));
  // One row, fetched by name: the header needs this queue's pause and usage state, not the whole
  // list to search through.
  const infoParams = { search: queue, limit: 1 };
  const queues = usePolledQuery<QueuePageDto>(queryKeys.queues(infoParams), () =>
    api.getQueues(infoParams),
  );
  // `search` is a substring match, so confirm the row really is this queue.
  const info = queues.data?.items.find((q) => q.name === queue);

  const [addOpen, setAddOpen] = useState(false);

  const pauseItems: DropdownItem[] = [
    {
      key: PauseMode.PROCESSING,
      label: PAUSE_MODES_CONFIG[PauseMode.PROCESSING].label,
      onClick: () =>
        void run({ kind: ActionKind.PAUSE, queue, mode: PauseMode.PROCESSING }, 'Paused'),
    },
    {
      key: PauseMode.ALL,
      label: PAUSE_MODES_CONFIG[PauseMode.ALL].label,
      onClick: () => void run({ kind: ActionKind.PAUSE, queue, mode: PauseMode.ALL }, 'Paused'),
    },
  ];

  const description = info
    ? `${pauseStateLabel(info)} · ${
        info.inUse ? QUEUE_USAGE_CONFIG.inUse.label : QUEUE_USAGE_CONFIG.unused.label
      }`
    : 'Jobs, activity and controls for this queue.';

  const actions = (
    <Inline gap={2} align="center" wrap>
      {info?.processingPaused ? (
        <Button
          icon={ACTIONS_CONFIG.resume.icon}
          onClick={() => void run({ kind: ActionKind.RESUME, queue }, 'Resumed')}
        >
          {ACTIONS_CONFIG.resume.label}
        </Button>
      ) : (
        <Dropdown items={pauseItems} align="right">
          <Button icon={ACTIONS_CONFIG.pause.icon}>
            {ACTIONS_CONFIG.pause.label} <span aria-hidden>▾</span>
          </Button>
        </Dropdown>
      )}
      <Button variant="primary" icon={ACTIONS_CONFIG.add.icon} onClick={() => setAddOpen(true)}>
        {ACTIONS_CONFIG.add.label}
      </Button>
      {info && !info.inUse && (
        <Popconfirm
          title="Remove this queue from the database?"
          description="Only allowed because no running process declares it. Job rows are untouched."
          okDanger
          onConfirm={() => void run({ kind: ActionKind.REMOVE_QUEUE, queue }, 'Queue removed')}
        >
          <Button variant="danger" icon={ACTIONS_CONFIG.remove.icon}>
            Remove queue
          </Button>
        </Popconfirm>
      )}
    </Inline>
  );

  return (
    <>
      <PageHeader title={queue} subtitle={description} extra={actions} />
      <Content>
        <Stack gap={4}>
          <KpiCards
            stats={stats.data}
            loading={stats.isLoading}
            error={stats.error}
            onRetry={() => void stats.refetch()}
          />
          <JobsTable queue={queue} />
        </Stack>
      </Content>

      <AddJobForm open={addOpen} queue={queue} onClose={() => setAddOpen(false)} />
    </>
  );
}
