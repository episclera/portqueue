/**
 * Instances page: every registered instance with its liveness, the health of the Node process it
 * runs at the last heartbeat, total jobs processed, and per-instance pause/resume. Server-paged;
 * only populated when instances run with an `instanceKey`.
 *
 * The per-status count breakdown deliberately isn't here. Eight numeric columns beside the health
 * metrics made the row unreadable and none of them answered a question this page is for; the
 * instance detail page carries the full jobs table instead.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Content, Mono, PageHeader, Table, Tag, Tooltip } from '@portqueue/ui';
import type { TableColumn } from '@portqueue/ui';
import { ActionKind, type InstanceDto, type InstancePageDto } from '../../shared/dto';
import { api } from '../queries/api';
import { queryKeys, usePolledQuery } from '../queries/use-queries';
import { useAction } from '../queries/use-action';
import { PAGE_SIZE, clampedPage, useTableParams } from '../queries/use-table-params';
import {
  ACTIONS_CONFIG,
  INSTANCE_ACTIONS_COPY,
  LIVENESS_CONFIG,
  PAUSE_STATE_FILTER_OPTIONS,
  instanceRemovable,
  pauseStateLabel,
} from '../constants/labels';
import { TableCard } from '../components/TableCard';
import { RowAction, RowActions } from '../components/RowActions';
import { dateColumn } from '../components/table-columns';
import {
  CPU_THRESHOLDS,
  MEMORY_THRESHOLDS,
  METRIC_HINTS,
  MetricValue,
  formatPercent,
  metricTone,
} from '../components/metrics';
import { totalCount } from '../components/format';
import { DOCS, EmptyState } from '../components/states';
import type { FilterDef } from '../components/FiltersModal';

const FILTER_KEYS = ['liveness', 'state'] as const;

const FILTER_DEFS: FilterDef[] = [
  {
    key: 'liveness',
    label: 'Liveness',
    options: [
      { label: LIVENESS_CONFIG.alive.label, value: 'alive' },
      { label: LIVENESS_CONFIG.stale.label, value: 'stale' },
    ],
  },
  { key: 'state', label: 'State', options: PAUSE_STATE_FILTER_OPTIONS },
];

export function InstancesPage(): React.ReactElement {
  const { run } = useAction();
  const params = useTableParams('instances', FILTER_KEYS);

  const liveness = params.filters.liveness?.[0];
  const state = params.filters.state?.[0];

  const listParams = {
    limit: PAGE_SIZE,
    offset: params.offset,
    ...(params.search ? { search: params.search } : {}),
    ...(liveness ? { alive: liveness === 'alive' } : {}),
    ...(state ? { processingPaused: state === 'paused' } : {}),
  };

  const instances = usePolledQuery<InstancePageDto>(queryKeys.instances(listParams), () =>
    api.getInstances(listParams),
  );

  const rows = instances.data?.items ?? [];
  const total = instances.data?.total ?? 0;

  const columns: TableColumn<InstanceDto>[] = [
    {
      title: 'Instance',
      key: 'instanceKey',
      render: (r) => (
        <Link to={`/instances/${encodeURIComponent(r.instanceKey)}`}>
          <Mono>{r.instanceKey}</Mono>
        </Link>
      ),
    },
    {
      title: 'Liveness',
      key: 'liveness',
      render: (r) => (
        <Tag tone={r.alive ? 'success' : 'neutral'}>
          {r.alive ? LIVENESS_CONFIG.alive.label : LIVENESS_CONFIG.stale.label}
        </Tag>
      ),
    },
    {
      title: 'State',
      key: 'state',
      render: (r) => (
        <Tag tone={r.processingPaused ? 'warning' : 'success'}>{pauseStateLabel(r)}</Tag>
      ),
    },
    {
      // Both health columns name their subject in the header, not only in the hover: the hover is
      // for the reader who wonders, the header is for the reader who doesn't and would otherwise
      // read these as the machine's load.
      title: 'CPU (process)',
      key: 'cpuPercent',
      align: 'right',
      render: (r) => (
        <Tooltip title={METRIC_HINTS.cpu} placement="bottom">
          <MetricValue tone={metricTone(r.cpuPercent, CPU_THRESHOLDS)}>
            {formatPercent(r.cpuPercent)}
          </MetricValue>
        </Tooltip>
      ),
    },
    {
      title: 'Memory (process)',
      key: 'memoryPercent',
      align: 'right',
      render: (r) => (
        <Tooltip title={METRIC_HINTS.memory} placement="bottom">
          <MetricValue tone={metricTone(r.memoryPercent, MEMORY_THRESHOLDS)}>
            {formatPercent(r.memoryPercent)}
          </MetricValue>
        </Tooltip>
      ),
    },
    {
      title: 'Processed',
      key: 'processed',
      align: 'right',
      render: (r) => totalCount(r.counts),
    },
    // The clock time of the last heartbeat. Whether that is recent is what the Liveness column
    // already answers, so this column doesn't need to count on its own.
    dateColumn<InstanceDto>('Last Seen', 'lastSeenAt', (r) => r.lastSeenAt),
    {
      title: 'Actions',
      key: 'actions',
      // Buttons hug the right edge; the title stays on the left, where it reads as this column's.
      align: 'right',
      headerAlign: 'left',
      render: (r: InstanceDto) => {
        const removable = instanceRemovable(r);
        return (
          <RowActions>
            {r.processingPaused ? (
              <RowAction
                icon={ACTIONS_CONFIG.resume.icon}
                label={ACTIONS_CONFIG.resume.label}
                onClick={() =>
                  void run(
                    { kind: ActionKind.RESUME_INSTANCE, instanceKey: r.instanceKey },
                    'Resumed',
                  )
                }
              />
            ) : (
              <RowAction
                icon={ACTIONS_CONFIG.pause.icon}
                label={ACTIONS_CONFIG.pause.label}
                confirm={{ title: INSTANCE_ACTIONS_COPY.pauseConfirm }}
                onClick={() =>
                  void run(
                    { kind: ActionKind.PAUSE_INSTANCE, instanceKey: r.instanceKey },
                    'Paused',
                  )
                }
              />
            )}
            <RowAction
              danger
              disabled={!removable}
              icon={ACTIONS_CONFIG.remove.icon}
              label={removable ? ACTIONS_CONFIG.remove.label : INSTANCE_ACTIONS_COPY.removeBlocked}
              confirm={{
                title: INSTANCE_ACTIONS_COPY.removeConfirm,
                description: INSTANCE_ACTIONS_COPY.removeConfirmDescription,
              }}
              onClick={() =>
                void run(
                  { kind: ActionKind.REMOVE_INSTANCE, instanceKey: r.instanceKey },
                  'Instance removed',
                )
              }
            />
          </RowActions>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Instances"
        subtitle="Liveness, the health of each instance's process at its last heartbeat, and jobs processed across the cluster."
      />
      <Content>
        <TableCard
          total={total}
          page={clampedPage(params.page, total)}
          onPageChange={params.setPage}
          loading={instances.isLoading}
          error={instances.error}
          errorTitle="Could not load instances"
          onRetry={() => void instances.refetch()}
          paginationLabel="Instances pagination"
          search={{
            value: params.search,
            onChange: params.setSearch,
            placeholder: 'Search instance key',
          }}
          filters={{
            defs: FILTER_DEFS,
            values: params.filters,
            onChange: params.setFilters,
            onClear: (key, value) => params.clearFilter(key as (typeof FILTER_KEYS)[number], value),
          }}
        >
          <Table<InstanceDto>
            rowKey={(r) => r.instanceKey}
            columns={columns}
            data={rows}
            empty={
              params.search ? (
                <EmptyState message={`No instances match “${params.search}”.`} />
              ) : (
                <EmptyState
                  message="No instances registered."
                  hint="Give each process an `instanceKey` to attribute jobs to it and control it from here — here's how."
                  docsHref={DOCS.scaleHorizontally}
                  docsLabel="Scaling horizontally"
                />
              )
            }
          />
        </TableCard>
      </Content>
    </>
  );
}
