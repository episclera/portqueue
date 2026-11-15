/**
 * Overview (home) page: the activity cards row, then the queues table. Both are server-paged and
 * poll on the shared interval — they are the two things this page exists to keep current.
 */
import React from 'react';
import { Table } from 'antd';
import type { TableColumnType } from 'antd';
import { ActionKind, type QueuePageDto, type QueueDto, type StatsDto } from '../../shared/dto';
import { api } from '../queries/api';
import { queryKeys, usePolledQuery } from '../queries/use-queries';
import { useAction } from '../queries/use-action';
import { PAGE_SIZE, clampedPage, useTableParams } from '../queries/use-table-params';
import { ACTIONS_CONFIG, PAUSE_STATE_FILTER_OPTIONS } from '../constants/labels';
import { KpiCards } from '../components/KpiCards';
import { TableCard } from '../components/TableCard';
import { RowAction, RowActions } from '../components/RowActions';
import { TABLE_PROPS, actionsColumn, countColumns } from '../components/table-columns';
import { PageBody, PageHeader } from '../components/layout';
import { DOCS, EmptyState } from '../components/states';
import type { FilterDef } from '../components/FiltersModal';
import { AppLink } from '../components/AppLink';
import { PauseStateTag } from '../components/StateTags';

const FILTER_KEYS = ['state'] as const;

/** The queue name gets the room in this table; the actions column holds one icon. */
const QUEUE_COLUMN_MIN_WIDTH = 280;
const ACTIONS_COLUMN_WIDTH = 96;

// No "usage" filter: `inUse` means "declared in the process that produced this row", and the
// dashboard runs on its own client rather than the application's — so it has no way to know which
// queues the workers declare.
const FILTER_DEFS: FilterDef[] = [
  { key: 'state', label: 'State', options: PAUSE_STATE_FILTER_OPTIONS },
];

export function OverviewPage(): React.ReactElement {
  const { run } = useAction();
  const params = useTableParams('queues', FILTER_KEYS);

  const state = params.filters.state?.[0];

  // The state filter is tri-state on the wire: an absent key means "don't narrow".
  const queueParams = {
    limit: PAGE_SIZE,
    offset: params.offset,
    ...(params.search ? { search: params.search } : {}),
    ...(state ? { processingPaused: state === 'paused' } : {}),
  };

  const stats = usePolledQuery<StatsDto>(queryKeys.stats(), () => api.getStats());
  const queues = usePolledQuery<QueuePageDto>(queryKeys.queues(queueParams), () =>
    api.getQueues(queueParams),
  );

  const rows = queues.data?.items ?? [];
  const total = queues.data?.total ?? 0;

  const columns: TableColumnType<QueueDto>[] = [
    {
      title: 'Queue',
      key: 'name',
      // The name is what a reader scans for, so it gets the room; the counts stay compact.
      onHeaderCell: () => ({ style: { minWidth: QUEUE_COLUMN_MIN_WIDTH } }),
      onCell: () => ({ style: { minWidth: QUEUE_COLUMN_MIN_WIDTH } }),
      render: (_, r) => <AppLink to={`/queues/${encodeURIComponent(r.name)}`}>{r.name}</AppLink>,
    },
    {
      title: 'State',
      key: 'state',
      render: (_, r) => <PauseStateTag row={r} />,
    },
    ...countColumns<QueueDto>(),
    actionsColumn<QueueDto>(
      (r) => (
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
      { align: 'left', width: ACTIONS_COLUMN_WIDTH },
    ),
  ];

  return (
    <>
      <PageHeader title="Overview" subtitle="Live queue health across every queue." />
      <PageBody>
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
          search={{
            value: params.search,
            onChange: params.setSearch,
            placeholder: 'Search queue name',
          }}
          filters={{
            defs: FILTER_DEFS,
            values: params.filters,
            onChange: params.setFilters,
            onClear: (key, value) => params.clearFilter(key as (typeof FILTER_KEYS)[number], value),
          }}
        >
          <Table<QueueDto>
            {...TABLE_PROPS}
            rowKey={(r) => r.name}
            columns={columns}
            dataSource={rows}
            locale={{
              emptyText: params.search ? (
                <EmptyState message={`No queues match “${params.search}”.`} />
              ) : (
                <EmptyState
                  message="No queues yet."
                  hint="A queue appears here the first time your app adds a job to it — here's how to add your first one."
                  docsHref={DOCS.firstQueue}
                  docsLabel="Getting started"
                />
              ),
            }}
          />
        </TableCard>
      </PageBody>
    </>
  );
}
