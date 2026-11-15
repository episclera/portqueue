/**
 * Queue detail page: the queue's activity cards and its jobs table. Pause / resume, add-a-job
 * and remove-queue live in the page's subheader band.
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Dropdown, Flex, Popconfirm } from 'antd';
import type { MenuProps } from 'antd';
import { CaretDownIcon } from '../icons';
import { PageBody, PageHeader } from '../components/layout';
import { PauseMode } from '../queries/enums';
import { ActionKind, type QueuePageDto, type StatsDto } from '../../shared/dto';
import { api } from '../queries/api';
import { queryKeys, usePolledQuery } from '../queries/use-queries';
import { useAction } from '../queries/use-action';
import { ACTIONS_CONFIG, PAUSE_MODES_CONFIG } from '../constants/labels';
import { KpiCards } from '../components/KpiCards';
import { JobsTable } from '../components/JobsTable';
import { AddJobForm } from '../components/AddJobForm';
import { PauseStateTag } from '../components/StateTags';

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

  const pauseMenu: MenuProps = {
    items: [PauseMode.PROCESSING, PauseMode.ALL].map((mode) => ({
      key: mode,
      label: PAUSE_MODES_CONFIG[mode].label,
    })),
    onClick: ({ key }) =>
      void run({ kind: ActionKind.PAUSE, queue, mode: key as PauseMode }, 'Paused'),
  };

  const actions = (
    <Flex gap="small" align="center" wrap>
      {info?.processingPaused ? (
        <Button
          icon={ACTIONS_CONFIG.resume.icon}
          onClick={() => void run({ kind: ActionKind.RESUME, queue }, 'Resumed')}
        >
          {ACTIONS_CONFIG.resume.label}
        </Button>
      ) : (
        <Dropdown menu={pauseMenu} trigger={['click']} placement="bottomRight">
          <Button icon={ACTIONS_CONFIG.pause.icon}>
            {ACTIONS_CONFIG.pause.label} <CaretDownIcon aria-hidden />
          </Button>
        </Dropdown>
      )}
      <Button type="primary" icon={ACTIONS_CONFIG.add.icon} onClick={() => setAddOpen(true)}>
        {ACTIONS_CONFIG.add.label}
      </Button>
      {info && (
        <Popconfirm
          title="Remove this queue from the database?"
          description="Refused while a running process still declares this queue. Job rows are untouched."
          okText="Remove queue"
          cancelText="Keep"
          okButtonProps={{ danger: true }}
          onConfirm={() => void run({ kind: ActionKind.REMOVE_QUEUE, queue }, 'Queue removed')}
        >
          <Button danger icon={ACTIONS_CONFIG.remove.icon}>
            Remove queue
          </Button>
        </Popconfirm>
      )}
    </Flex>
  );

  return (
    <>
      <PageHeader
        entity="Queue"
        title={queue}
        tags={info ? <PauseStateTag row={info} /> : undefined}
        subtitle="Jobs, activity and controls for this queue."
        extra={actions}
      />
      <PageBody>
        <KpiCards
          stats={stats.data}
          loading={stats.isLoading}
          error={stats.error}
          onRetry={() => void stats.refetch()}
        />
        <JobsTable queue={queue} />
      </PageBody>

      <AddJobForm open={addOpen} queue={queue} onClose={() => setAddOpen(false)} />
    </>
  );
}
