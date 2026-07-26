/**
 * Overview (home) page: the activity cards row, then the queues table. Both are server-paged and
 * poll on the shared interval — they are the two things this page exists to keep current.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Content, PageHeader, Stack, Table, Tag } from '@portqueue/ui';
import type { TableColumn } from '@portqueue/ui';
import { ActionKind, type QueuePageDto, type QueueDto, type StatsDto } from '../../shared/dto';
import { api } from '../queries/api';
import { queryKeys, usePolledQuery } from '../queries/use-queries';
import { useAction } from '../queries/use-action';
import { PAGE_SIZE, clampedPage, useTableParams } from '../queries/use-table-params';
import {
  ACTIONS_CONFIG,
  PAUSE_STATE_FILTER_OPTIONS,
  QUEUE_USAGE_CONFIG,
  pauseStateLabel,
} from '../constants/labels';
import { KpiCards } from '../components/KpiCards';
import { TableCard } from '../components/TableCard';
import { RowAction, RowActions } from '../components/RowActions';
import { countColumns } from '../components/table-columns';
import { DOCS, EmptyState } from '../components/states';
import type { FilterDef } from '../components/FiltersModal';

const FILTER_KEYS = ['state', 'usage'] as const;

const FILTER_DEFS: FilterDef[] = [
  { key: 'state', label: 'State', options: PAUSE_STATE_FILTER_OPTIONS },
  {
    key: 'usage',
    label: 'Usage',
    options: [
      { label: QUEUE_USAGE_CONFIG.inUse.label, value: 'inUse' },
      { label: QUEUE_USAGE_CONFIG.unused.label, value: 'unused' },
    ],
  },
];

export function OverviewPage(): React.ReactElement {
  const { run } = useAction();
  const params = useTableParams('queues', FILTER_KEYS);

  const state = params.filters.state?.[0];
  const usage = params.filters.usage?.[0];

  // Both filters are tri-state on the wire: an absent key means "don't narrow".
  const queueParams = {
    limit: PAGE_SIZE,
    offset: params.offset,
    ...(params.search ? { search: params.search } : {}),
    ...(state ? { processingPaused: state === 'paused' } : {}),
    ...(usage ? { inUse: usage === 'inUse' } : {}),
  };

  const stats = usePolledQuery<StatsDto>(queryKeys.stats(), () => api.getStats());
  const queues = usePolledQuery<QueuePageDto>(queryKeys.queues(queueParams), () =>
    api.getQueues(queueParams),
  );

  const rows = queues.data?.items ?? [];
  const total = queues.data?.total ?? 0;

  const columns: TableColumn<QueueDto>[] = [
    {
      title: 'Queue',
      key: 'name',
      render: (r) => <Link to={`/queues/${encodeURIComponent(r.name)}`}>{r.name}</Link>,
    },
    {
      title: 'State',
      key: 'state',
      render: (r) => (
        <Tag tone={r.processingPaused ? 'warning' : 'success'}>{pauseStateLabel(r)}</Tag>
      ),
    },
    {
      title: 'Usage',
      key: 'usage',
      render: (r) => (
        <Tag tone={r.inUse ? 'info' : 'neutral'}>
          {r.inUse ? QUEUE_USAGE_CONFIG.inUse.label : QUEUE_USAGE_CONFIG.unused.label}
        </Tag>
      ),
    },
    ...countColumns<QueueDto>(),
    {
      title: 'Actions',
      key: 'actions',
      // Buttons hug the right edge; the title stays on the left, where it reads as this column's.
      align: 'right',
      headerAlign: 'left',
      render: (r) => (
        <RowActions>
          {r.processingPaused ? (
            <RowAction
              icon={ACTIONS_CONFIG.resume.icon}
              label={ACTIONS_CONFIG.resume.label}
              onClick={() => void run({ kind: ActionKind.RESUME, queue: r.name }, 'Resumed')}
            />
          ) : (
            <RowAction
              icon={ACTIONS_CONFIG.pause.icon}
              label={ACTIONS_CONFIG.pause.label}
              confirm={{ title: 'Pause processing on this queue?' }}
              onClick={() => void run({ kind: ActionKind.PAUSE, queue: r.name }, 'Paused')}
            />
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Overview" subtitle="Live queue health across every queue." />
      <Content>
        <Stack gap={4}>
          <KpiCards
            stats={stats.data}
            loading={stats.isLoading}
            error={stats.error}
            onRetry={() => void stats.refetch()}
          />

          <TableCard
            total={total}
            page={clampedPage(params.page, total)}
            onPageChange={params.setPage}
            loading={queues.isLoading}
            error={queues.error}
            errorTitle="Could not load queues"
            onRetry={() => void queues.refetch()}
            paginationLabel="Queues pagination"
            search={{
              value: params.search,
              onChange: params.setSearch,
              placeholder: 'Search queue name',
            }}
            filters={{
              defs: FILTER_DEFS,
              values: params.filters,
              onChange: params.setFilters,
              onClear: (key, value) =>
                params.clearFilter(key as (typeof FILTER_KEYS)[number], value),
            }}
          >
            <Table<QueueDto>
              rowKey={(r) => r.name}
              columns={columns}
              data={rows}
              empty={
                params.search ? (
                  <EmptyState message={`No queues match “${params.search}”.`} />
                ) : (
                  <EmptyState
                    message="No queues yet."
                    hint="A queue appears here the first time your app adds a job to it — here's how to add your first one."
                    docsHref={DOCS.firstQueue}
                    docsLabel="Getting started"
                  />
                )
              }
            />
          </TableCard>
        </Stack>
      </Content>
    </>
  );
}
