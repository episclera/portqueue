/**
 * Instances page: every registered instance with liveness, per-instance job attribution, and
 * per-instance pause/resume. Only populated when instances run with an `instanceKey`.
 */
import React from 'react';
import { Content, Mono, PageHeader, Table, Tag, Text } from '@portqueue/ui';
import type { TableColumn } from '@portqueue/ui';
import type { InstanceDto } from '../../shared/dto';
import { api, config } from '../queries/api';
import { usePoll } from '../queries/use-poll';
import { useAction } from '../queries/use-action';
import { filterAndPage, useTableParams } from '../queries/use-table-params';
import {
  ACTIONS_CONFIG,
  LIVENESS_CONFIG,
  PAUSE_STATE_FILTER_OPTIONS,
  pauseStateLabel,
} from '../constants/labels';
import { TableCard } from '../components/TableCard';
import { RowAction, RowActions } from '../components/RowActions';
import { countColumns } from '../components/table-columns';
import type { FilterDef } from '../components/FiltersModal';
import { formatDate } from '../components/format';

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

const EMPTY_TEXT =
  'No instances registered. Set an `instanceKey` on the PortQueue to attribute jobs per instance.';

/** Core only lets an instance be removed once it has been unseen for 30 minutes. */
const REMOVABLE_AFTER_MS = 30 * 60 * 1000;

export function InstancesPage(): React.ReactElement {
  const { run } = useAction();
  const instances = usePoll<InstanceDto[]>(() => api.getInstances(), []);
  const params = useTableParams('instances', FILTER_KEYS);

  const liveness = params.filters.liveness?.[0];
  const state = params.filters.state?.[0];

  const page = filterAndPage(instances.data ?? [], params, {
    matches: (row, term) => row.instanceKey.toLowerCase().includes(term),
    keep: (row) => {
      if (liveness === 'alive' && !row.alive) return false;
      if (liveness === 'stale' && row.alive) return false;
      if (state === 'running' && row.processingPaused) return false;
      if (state === 'paused' && !row.processingPaused) return false;
      return true;
    },
  });

  const columns: TableColumn<InstanceDto>[] = [
    {
      title: 'Instance',
      key: 'instanceKey',
      render: (r) => <Mono>{r.instanceKey}</Mono>,
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
    ...countColumns<InstanceDto>(),
    {
      title: 'Last Seen',
      key: 'lastSeenAt',
      render: (r) => formatDate(r.lastSeenAt),
    },
    ...(config.readOnly
      ? []
      : [
          {
            title: 'Actions',
            key: 'actions',
            align: 'right',
            render: (r: InstanceDto) => {
              const removable = Date.now() - new Date(r.lastSeenAt).getTime() > REMOVABLE_AFTER_MS;
              return (
                <RowActions>
                  {r.processingPaused ? (
                    <RowAction
                      icon={ACTIONS_CONFIG.resume.icon}
                      label={ACTIONS_CONFIG.resume.label}
                      onClick={() =>
                        void run({ kind: 'resumeInstance', instanceKey: r.instanceKey }, 'Resumed')
                      }
                    />
                  ) : (
                    <RowAction
                      icon={ACTIONS_CONFIG.pause.icon}
                      label={ACTIONS_CONFIG.pause.label}
                      confirm={{ title: 'Pause job processing on this instance?' }}
                      onClick={() =>
                        void run({ kind: 'pauseInstance', instanceKey: r.instanceKey }, 'Paused')
                      }
                    />
                  )}
                  <RowAction
                    danger
                    disabled={!removable}
                    icon={ACTIONS_CONFIG.remove.icon}
                    label={
                      removable ? ACTIONS_CONFIG.remove.label : 'Removable after 30 minutes unseen'
                    }
                    confirm={{
                      title: 'Remove this inactive instance from monitoring?',
                      description: 'Only tidies the instances list; job history is untouched.',
                    }}
                    onClick={() =>
                      void run(
                        { kind: 'removeInstance', instanceKey: r.instanceKey },
                        'Instance removed',
                      )
                    }
                  />
                </RowActions>
              );
            },
          } satisfies TableColumn<InstanceDto>,
        ]),
  ];

  return (
    <>
      <PageHeader
        title="Instances"
        subtitle="Liveness and per-instance job attribution across the cluster."
      />
      <Content>
        <TableCard
          total={page.total}
          page={params.page}
          onPageChange={params.setPage}
          loading={instances.loading && !instances.data}
          paginationLabel="Instances pagination"
          search={{
            value: params.search,
            onChange: params.setSearch,
            placeholder: 'Search instance key',
          }}
          filters={{ defs: FILTER_DEFS, values: params.filters, onChange: params.setFilters }}
        >
          <Table<InstanceDto>
            rowKey={(r) => r.instanceKey}
            columns={columns}
            data={page.rows}
            empty={<Text $tone="muted">{EMPTY_TEXT}</Text>}
          />
        </TableCard>
      </Content>
    </>
  );
}
