/**
 * Overview (home) page: the activity cards row, then the queues table — nothing else. The
 * table is searchable by queue name, filterable by state, and paged 20 rows at a time.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Content, PageHeader, Stack, Table, Tag, Text } from '@portqueue/ui';
import type { TableColumn } from '@portqueue/ui';
import type { QueueDto, StatsDto } from '../../shared/dto';
import { api, config } from '../queries/api';
import { usePoll } from '../queries/use-poll';
import { useAction } from '../queries/use-action';
import { filterAndPage, useTableParams } from '../queries/use-table-params';
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

  const stats = usePoll<StatsDto>(() => api.getStats(), []);
  const queues = usePoll<QueueDto[]>(() => api.getQueues(), []);

  const state = params.filters.state?.[0];
  const usage = params.filters.usage?.[0];

  const page = filterAndPage(queues.data ?? [], params, {
    matches: (queue, term) => queue.name.toLowerCase().includes(term),
    keep: (queue) => {
      if (state === 'running' && queue.processingPaused) return false;
      if (state === 'paused' && !queue.processingPaused) return false;
      if (usage === 'inUse' && !queue.inUse) return false;
      if (usage === 'unused' && queue.inUse) return false;
      return true;
    },
  });

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
      align: 'right',
      render: (r) =>
        config.readOnly ? (
          <Link to={`/queues/${encodeURIComponent(r.name)}`}>{ACTIONS_CONFIG.open.label}</Link>
        ) : (
          <RowActions>
            {r.processingPaused ? (
              <RowAction
                icon={ACTIONS_CONFIG.resume.icon}
                label={ACTIONS_CONFIG.resume.label}
                onClick={() => void run({ kind: 'resume', queue: r.name }, 'Resumed')}
              />
            ) : (
              <RowAction
                icon={ACTIONS_CONFIG.pause.icon}
                label={ACTIONS_CONFIG.pause.label}
                confirm={{ title: 'Pause processing on this queue?' }}
                onClick={() => void run({ kind: 'pause', queue: r.name }, 'Paused')}
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
          <KpiCards stats={stats.data} loading={stats.loading} />

          <TableCard
            total={page.total}
            page={params.page}
            onPageChange={params.setPage}
            loading={queues.loading && !queues.data}
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
            }}
          >
            <Table<QueueDto>
              rowKey={(r) => r.name}
              columns={columns}
              data={page.rows}
              empty={<Text $tone="muted">No queues yet.</Text>}
            />
          </TableCard>
        </Stack>
      </Content>
    </>
  );
}
