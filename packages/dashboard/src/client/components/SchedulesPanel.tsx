/**
 * Schedules table: selectable rows with bulk unschedule, per-row icon actions, a search over
 * the cadence pattern / queue, and a state filter. Paged client-side — the API returns every
 * schedule for the requested scope.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Code, Table, Tag, Text } from '@portqueue/ui';
import type { DropdownItem, TableColumn } from '@portqueue/ui';
import type { ScheduleDto } from '../../shared/dto';
import { config } from '../queries/api';
import { useAction } from '../queries/use-action';
import { filterAndPage, useTableParams } from '../queries/use-table-params';
import { ACTIONS_CONFIG, SCHEDULE_STATES_CONFIG } from '../constants/labels';
import { formatDate, relativeTime } from './format';
import { TableCard } from './TableCard';
import type { FilterDef } from './FiltersModal';
import { BulkActionsButton, ConfirmModal, RowAction, RowActions } from './RowActions';

export interface SchedulesPanelProps {
  rows: ScheduleDto[];
  loading: boolean;
  onChanged: () => void;
}

const FILTER_KEYS = ['state'] as const;

const FILTER_DEFS: FilterDef[] = [
  {
    key: 'state',
    label: 'State',
    options: [
      { label: SCHEDULE_STATES_CONFIG.enabled.label, value: 'enabled' },
      { label: SCHEDULE_STATES_CONFIG.disabled.label, value: 'disabled' },
    ],
  },
];

/** The human cadence of a schedule — a cron pattern or a fixed interval. */
function cadence(row: ScheduleDto): string {
  if (row.cron) return row.cron;
  if (row.every) return `every ${Math.round(row.every / 1000)}s`;
  return '—';
}

export function SchedulesPanel({
  rows,
  loading,
  onChanged,
}: SchedulesPanelProps): React.ReactElement {
  const { run } = useAction();
  const readOnly = config.readOnly;
  const params = useTableParams('schedules', FILTER_KEYS);
  const state = params.filters.state?.[0];

  const [selected, setSelected] = useState<string[]>([]);
  const [confirmBulkRemove, setConfirmBulkRemove] = useState(false);

  const page = filterAndPage(rows, params, {
    matches: (row, term) =>
      cadence(row).toLowerCase().includes(term) ||
      row.queue.toLowerCase().includes(term) ||
      row.scheduleId.toLowerCase().includes(term),
    keep: (row) => {
      if (state === 'enabled' && !row.enabled) return false;
      if (state === 'disabled' && row.enabled) return false;
      return true;
    },
  });

  useEffect(() => setSelected([]), [params.search, state, params.offset]);

  const removeSchedule = async (row: ScheduleDto): Promise<void> => {
    await run(
      { kind: 'removeSchedule', queue: row.queue, scheduleId: row.scheduleId },
      'Schedule removed',
    );
    onChanged();
  };

  const removeSelected = async (): Promise<void> => {
    const targets = rows.filter((row) => selected.includes(row.scheduleId));
    for (const row of targets) {
      await run(
        { kind: 'removeSchedule', queue: row.queue, scheduleId: row.scheduleId },
        undefined,
        {
          silent: true,
        },
      );
    }
    setSelected([]);
    onChanged();
  };

  const columns: TableColumn<ScheduleDto>[] = [
    {
      title: 'Queue',
      key: 'queue',
      render: (r) => <Link to={`/queues/${encodeURIComponent(r.queue)}`}>{r.queue}</Link>,
    },
    {
      title: 'Cadence',
      key: 'cadence',
      render: (r) => (r.cron ? <Code>{r.cron}</Code> : cadence(r)),
    },
    {
      title: 'Timezone',
      key: 'timezone',
      render: (r) => r.timezone ?? 'UTC',
    },
    {
      title: 'Next Run',
      key: 'nextRunAt',
      render: (r) => (r.nextRunAt ? relativeTime(r.nextRunAt) : '—'),
    },
    {
      title: 'Last Run',
      key: 'lastRunAt',
      render: (r) => formatDate(r.lastRunAt),
    },
    {
      title: 'State',
      key: 'enabled',
      render: (r) => (
        <Tag tone={r.enabled ? 'success' : 'neutral'}>
          {r.enabled ? SCHEDULE_STATES_CONFIG.enabled.label : SCHEDULE_STATES_CONFIG.disabled.label}
        </Tag>
      ),
    },
    ...(readOnly
      ? []
      : [
          {
            title: 'Actions',
            key: 'actions',
            align: 'right',
            render: (r: ScheduleDto) => (
              <RowActions>
                <RowAction
                  danger
                  icon={ACTIONS_CONFIG.remove.icon}
                  label={ACTIONS_CONFIG.remove.label}
                  confirm={{ title: 'Remove this schedule?' }}
                  onClick={() => void removeSchedule(r)}
                />
              </RowActions>
            ),
          } satisfies TableColumn<ScheduleDto>,
        ]),
  ];

  const bulkItems: DropdownItem[] = [
    {
      key: 'remove',
      label: `${ACTIONS_CONFIG.remove.label} selected`,
      icon: ACTIONS_CONFIG.remove.icon,
      danger: true,
      onClick: () => setConfirmBulkRemove(true),
    },
  ];

  return (
    <>
      <TableCard
        total={page.total}
        page={params.page}
        onPageChange={params.setPage}
        loading={loading}
        paginationLabel="Schedules pagination"
        search={{
          value: params.search,
          onChange: params.setSearch,
          placeholder: 'Search cadence or queue',
        }}
        filters={{ defs: FILTER_DEFS, values: params.filters, onChange: params.setFilters }}
        toolbarLeading={<BulkActionsButton count={selected.length} items={bulkItems} />}
      >
        <Table<ScheduleDto>
          rowKey={(r) => r.scheduleId}
          columns={columns}
          data={page.rows}
          empty={<Text $tone="muted">No recurring schedules.</Text>}
          {...(readOnly ? {} : { rowSelection: { selectedKeys: selected, onChange: setSelected } })}
        />
      </TableCard>

      <ConfirmModal
        open={confirmBulkRemove}
        title={`Remove ${selected.length} schedule(s)?`}
        description="The selected recurring definitions stop firing. Jobs they already created are kept."
        okText={ACTIONS_CONFIG.remove.label}
        okDanger
        onClose={() => setConfirmBulkRemove(false)}
        onConfirm={() => void removeSelected()}
      />
    </>
  );
}
