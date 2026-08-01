/**
 * Schedules table: server-paged and searchable, with per-row enable/disable and remove, and a
 * bulk unschedule that removes every selected definition in one transactional request.
 *
 * Each schedule id links to its detail page, where the jobs it produced are listed.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { Code, Table, Tag } from '@portqueue/ui';
import type { DropdownItem, TableColumn } from '@portqueue/ui';
import { ActionKind, type ScheduleDto, type SchedulePageDto } from '../../shared/dto';
import { api } from '../queries/api';
import { queryKeys, usePolledQuery } from '../queries/use-queries';
import { useAction } from '../queries/use-action';
import { PAGE_SIZE, clampedPage, useTableParams } from '../queries/use-table-params';
import { ACTIONS_CONFIG, SCHEDULE_STATES_CONFIG } from '../constants/labels';
import { truncate } from './format';
import { dateColumn } from './table-columns';
import { TableCard } from './TableCard';
import { DOCS, EmptyState } from './states';
import type { FilterDef } from './FiltersModal';
import { BulkActionsButton, ConfirmModal, RowAction, RowActions } from './RowActions';

export interface SchedulesPanelProps {
  /** Narrow to one queue's schedules. Omitted on the all-queues page. */
  queue?: string;
}

/** Generated schedule ids are as long as job ids, and truncate the same way. */
const MonoLink = styled(Link)`
  font-family: ${(p) => p.theme.font.mono};
  font-size: 12px;
`;

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
export function cadence(row: ScheduleDto): string {
  if (row.cron) return row.cron;
  if (row.everySeconds) return `every ${row.everySeconds}s`;
  return '—';
}

export function SchedulesPanel({ queue }: SchedulesPanelProps): React.ReactElement {
  const { run, runBatch } = useAction();
  const params = useTableParams('schedules', FILTER_KEYS);
  const state = params.filters.state?.[0];

  const [selected, setSelected] = useState<string[]>([]);
  const [confirmBulkRemove, setConfirmBulkRemove] = useState(false);

  const listParams = {
    limit: PAGE_SIZE,
    offset: params.offset,
    ...(queue ? { queue } : {}),
    ...(params.search ? { search: params.search } : {}),
    ...(state ? { enabled: state === 'enabled' } : {}),
  };

  const schedules = usePolledQuery<SchedulePageDto>(queryKeys.schedules(listParams), () =>
    api.getSchedules(listParams),
  );

  const rows = useMemo(() => schedules.data?.items ?? [], [schedules.data]);
  const total = schedules.data?.total ?? 0;

  useEffect(() => setSelected([]), [queue, params.search, state, params.offset]);

  // Drop ids a poll removed from under the selection, so a bulk action can't target them.
  useEffect(() => {
    const visible = new Set(rows.map((r) => r.scheduleId));
    setSelected((current) => {
      const next = current.filter((id) => visible.has(id));
      return next.length === current.length ? current : next;
    });
  }, [rows]);

  const columns: TableColumn<ScheduleDto>[] = [
    {
      title: 'Schedule',
      key: 'scheduleId',
      render: (r) => (
        <MonoLink to={`/schedules/${encodeURIComponent(r.scheduleId)}`}>
          {truncate(r.scheduleId)}
        </MonoLink>
      ),
    },
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
    { title: 'Timezone', key: 'timezone', render: (r) => r.timezone ?? 'UTC' },
    dateColumn<ScheduleDto>('Next Run', 'nextRunAt', (r) => r.nextRunAt),
    dateColumn<ScheduleDto>('Last Run', 'lastRunAt', (r) => r.lastRunAt),
    {
      title: 'State',
      key: 'enabled',
      render: (r) => (
        <Tag tone={r.enabled ? 'success' : 'neutral'}>
          {r.enabled ? SCHEDULE_STATES_CONFIG.enabled.label : SCHEDULE_STATES_CONFIG.disabled.label}
        </Tag>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      // Buttons hug the right edge; the title stays on the left, where it reads as this column's.
      align: 'right',
      headerAlign: 'left',
      render: (r: ScheduleDto) => (
        <RowActions>
          {/* Disabling is the reversible alternative to removing: the definition stays, it just
              stops firing. Worth offering first when someone wants a schedule to stop. */}
          {r.enabled ? (
            <RowAction
              icon={ACTIONS_CONFIG.pause.icon}
              label="Disable"
              confirm={{ title: 'Stop this schedule from firing?' }}
              onClick={() =>
                void run(
                  {
                    kind: ActionKind.SET_SCHEDULE_ENABLED,
                    scheduleId: r.scheduleId,
                    enabled: false,
                  },
                  'Schedule disabled',
                )
              }
            />
          ) : (
            <RowAction
              icon={ACTIONS_CONFIG.resume.icon}
              label="Enable"
              onClick={() =>
                void run(
                  {
                    kind: ActionKind.SET_SCHEDULE_ENABLED,
                    scheduleId: r.scheduleId,
                    enabled: true,
                  },
                  'Schedule enabled',
                )
              }
            />
          )}
          <RowAction
            danger
            icon={ACTIONS_CONFIG.remove.icon}
            label={ACTIONS_CONFIG.remove.label}
            confirm={{ title: 'Remove this schedule?' }}
            onClick={() =>
              void run(
                { kind: ActionKind.REMOVE_SCHEDULE, scheduleId: r.scheduleId },
                'Schedule removed',
              )
            }
          />
        </RowActions>
      ),
    },
  ];

  const removeSelected = async (): Promise<void> => {
    await runBatch(
      { kind: ActionKind.REMOVE_SCHEDULE, scheduleIds: [...selected] },
      { verb: 'Removed', noun: 'schedule' },
    );
    setSelected([]);
  };

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
        total={total}
        page={clampedPage(params.page, total)}
        onPageChange={params.setPage}
        loading={schedules.isLoading}
        error={schedules.error}
        errorTitle="Could not load schedules"
        onRetry={() => void schedules.refetch()}
        paginationLabel="Schedules pagination"
        search={{
          value: params.search,
          onChange: params.setSearch,
          placeholder: 'Search id, queue or cadence',
        }}
        filters={{
          defs: FILTER_DEFS,
          values: params.filters,
          onChange: params.setFilters,
          onClear: (key, value) => params.clearFilter(key as (typeof FILTER_KEYS)[number], value),
        }}
        toolbarLeading={<BulkActionsButton count={selected.length} items={bulkItems} />}
      >
        <Table<ScheduleDto>
          rowKey={(r) => r.scheduleId}
          columns={columns}
          data={rows}
          empty={
            params.search ? (
              <EmptyState message={`No schedules match “${params.search}”.`} />
            ) : (
              <EmptyState
                message="No recurring schedules."
                hint="Pass `schedule: { cron }` or `schedule: { startEverySeconds }` to addJob to create one — here's how."
                docsHref={DOCS.scheduling}
                docsLabel="Scheduling guide"
              />
            )
          }
          rowSelection={{ selectedKeys: selected, onChange: setSelected }}
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
