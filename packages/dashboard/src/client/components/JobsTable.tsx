/**
 * The jobs table: server-paged (20 rows a page) with the page, the search term and the status
 * filter all held in the URL. Rows are selectable for bulk retry / cancel / remove — each of
 * which is **one** transactional request, not a fan-out — and every row carries the same three
 * actions as icon buttons.
 *
 * Reused by the queue, schedule and instance detail pages: `scheduleId` narrows it to the jobs one
 * schedule produced, `instanceKey` to the jobs one instance claimed.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { App, Table, Tooltip } from 'antd';
import type { TableColumnType } from 'antd';
import { JobStatus } from '../queries/enums';
import { ActionKind, type JobDto, type JobPageDto } from '../../shared/dto';
import { api, config } from '../queries/api';
import { queryKeys, usePolledQuery } from '../queries/use-queries';
import { useAction } from '../queries/use-action';
import { PAGE_SIZE, clampedPage, useTableParams } from '../queries/use-table-params';
import { ACTIONS_CONFIG, STALLED, STATUSES_CONFIG, statusLabel } from '../constants/labels';
import { truncate } from './format';
import { TABLE_PROPS, actionsColumn, cappedRowSelection, dateColumn } from './table-columns';
import { TableCard } from './TableCard';
import { DOCS, EmptyState } from './states';
import { StatusTag } from './StatusTag';
import type { FilterDef } from './FiltersModal';
import { BulkActionsButton, RowAction, RowActions, type BulkItem } from './RowActions';
import { AppLink } from './AppLink';

export interface JobsTableProps {
  /** Narrow to one queue. Omitted on views that span queues. */
  queue?: string;
  /** Narrow to the jobs one schedule produced. */
  scheduleId?: string;
  /** Narrow to the jobs one instance claimed. */
  instanceKey?: string;
  /** URL param prefix, so two job tables on one page don't share state. */
  prefix?: string;
}

const FILTER_KEYS = ['status'] as const;

const FILTER_DEFS: FilterDef[] = [
  {
    key: 'status',
    label: 'Status',
    options: Object.values(JobStatus).map((s) => ({ label: STATUSES_CONFIG[s].label, value: s })),
  },
];

/** A job can be cancelled while it is still on its way through the queue. */
const CANCELLABLE: JobStatus[] = [JobStatus.PENDING, JobStatus.ACTIVE, JobStatus.RETRY];

export function JobsTable({
  queue,
  scheduleId,
  instanceKey,
  prefix = 'jobs',
}: JobsTableProps): React.ReactElement {
  const { run, runBatch } = useAction();
  const { modal } = App.useApp();
  const params = useTableParams(prefix, FILTER_KEYS);
  const statusesKey = (params.filters.status ?? []).join(',');

  const [selected, setSelected] = useState<string[]>([]);

  const listParams = {
    ...(queue ? { queue } : {}),
    ...(scheduleId ? { scheduleId } : {}),
    ...(instanceKey ? { instanceKey } : {}),
    ...(statusesKey ? { statuses: statusesKey } : {}),
    ...(params.search ? { search: params.search } : {}),
    offset: params.offset,
    limit: PAGE_SIZE,
  };

  const jobs = usePolledQuery<JobPageDto>(queryKeys.jobs(listParams), () =>
    api.getJobs(listParams),
  );

  const rows = useMemo(() => jobs.data?.items ?? [], [jobs.data]);
  const total = jobs.data?.total ?? 0;

  // A different page / filter / search means a different row set; drop the stale selection.
  useEffect(() => setSelected([]), [queue, scheduleId, statusesKey, params.search, params.offset]);

  // A poll can also remove rows underneath the selection — a completed job retained out, another
  // operator's removal. Intersecting after every fetch keeps a bulk action from targeting ids
  // that are no longer on screen (and no longer in the database).
  useEffect(() => {
    const visible = new Set(rows.map((r) => r.id));
    setSelected((current) => {
      const next = current.filter((id) => visible.has(id));
      return next.length === current.length ? current : next;
    });
  }, [rows]);

  const columns: TableColumnType<JobDto>[] = [
    {
      title: 'Job',
      key: 'id',
      render: (_, r) => (
        // A plain link, truncated; the full id is on hover and in the accessible name.
        <AppLink to={`/jobs/${encodeURIComponent(r.id)}`} title={r.id} aria-label={r.id}>
          {truncate(r.id)}
        </AppLink>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, r) => {
        const status = r.stalled ? STALLED : r.status;
        return <StatusTag status={status} label={statusLabel(status)} />;
      },
    },
    {
      title: 'Attempt',
      key: 'attempt',
      render: (_, r) => `${r.retryAttempt}/${r.retryMaxAttempts}`,
    },
    { title: 'Priority', dataIndex: 'priority', key: 'priority' },
    {
      title: 'Processed On Instance',
      key: 'processedOnInstanceKey',
      // Linked: "what else was that process doing?" is the next question, one click away.
      render: (_, r) =>
        r.processedOnInstanceKey ? (
          <Tooltip title={r.processedOnInstanceKey} placement="bottom">
            <AppLink
              to={`/instances/${encodeURIComponent(r.processedOnInstanceKey)}`}
              aria-label={r.processedOnInstanceKey}
            >
              {truncate(r.processedOnInstanceKey, 8, 4)}
            </AppLink>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    dateColumn<JobDto>('Created At', 'createdAt', (r) => r.createdAt),
    dateColumn<JobDto>('Start After', 'startAfter', (r) => r.startAfter),
    dateColumn<JobDto>('Completed At', 'completedAt', (r) => r.completedAt),
    dateColumn<JobDto>('Failed At', 'failedAt', (r) => r.failedAt),
    actionsColumn<JobDto>((r) => (
      <RowActions>
        <RowAction
          icon={ACTIONS_CONFIG.retry.icon}
          label={ACTIONS_CONFIG.retry.label}
          disabled={r.status === JobStatus.ACTIVE}
          onClick={() => void run({ kind: ActionKind.RETRY, jobId: r.id }, 'Retry queued')}
        />
        <RowAction
          icon={ACTIONS_CONFIG.cancel.icon}
          label={ACTIONS_CONFIG.cancel.label}
          disabled={!CANCELLABLE.includes(r.status as JobStatus)}
          confirm={{ title: 'Cancel this job?' }}
          onClick={() => void run({ kind: ActionKind.CANCEL, jobId: r.id }, 'Cancelled')}
        />
        <RowAction
          danger
          icon={ACTIONS_CONFIG.remove.icon}
          label={ACTIONS_CONFIG.remove.label}
          confirm={{ title: 'Remove this job permanently?' }}
          onClick={() => void run({ kind: ActionKind.REMOVE, jobId: r.id }, 'Removed')}
        />
      </RowActions>
    )),
  ];

  /**
   * One request for the whole selection, applied in a single server-side transaction, reported in a
   * single toast.
   *
   * A selection spanning queues used to be grouped by queue and sent as one request *per queue*,
   * each with its own toast — so a failure on the second queue left the first queue's jobs already
   * removed, with a success toast and an error toast side by side. A job id identifies a row on its
   * own, so the queue was never needed to act on it.
   */
  const runBulk = async (kind: ActionKind, verb: string): Promise<void> => {
    await runBatch({ kind, jobIds: [...selected] }, { verb, noun: 'job' });
    setSelected([]);
  };

  const bulkItems: BulkItem[] = [
    {
      key: 'retry',
      label: `${ACTIONS_CONFIG.retry.label} selected`,
      icon: ACTIONS_CONFIG.retry.icon,
      onClick: () => void runBulk(ActionKind.RETRY, 'Requeued'),
    },
    {
      key: 'cancel',
      label: `${ACTIONS_CONFIG.cancel.label} selected`,
      icon: ACTIONS_CONFIG.cancel.icon,
      onClick: () => void runBulk(ActionKind.CANCEL, 'Cancelled'),
    },
    {
      key: 'remove',
      label: `${ACTIONS_CONFIG.remove.label} selected`,
      icon: ACTIONS_CONFIG.remove.icon,
      danger: true,
      onClick: () =>
        void modal.confirm({
          title: `Remove ${selected.length} job(s)?`,
          content: 'This permanently deletes the selected job rows. It cannot be undone.',
          okText: ACTIONS_CONFIG.remove.label,
          okButtonProps: { danger: true },
          onOk: () => runBulk(ActionKind.REMOVE, 'Removed'),
        }),
    },
  ];

  return (
    <TableCard
      total={total}
      page={clampedPage(params.page, total)}
      onPageChange={params.setPage}
      loading={jobs.isLoading}
      error={jobs.error}
      errorTitle="Could not load jobs"
      onRetry={() => void jobs.refetch()}
      search={{
        value: params.search,
        onChange: params.setSearch,
        placeholder: 'Search id, status, key, error or payload',
      }}
      filters={{
        defs: FILTER_DEFS,
        values: params.filters,
        onChange: params.setFilters,
        onClear: (key, value) => params.clearFilter(key as (typeof FILTER_KEYS)[number], value),
      }}
      toolbarLeading={<BulkActionsButton count={selected.length} items={bulkItems} />}
    >
      <Table<JobDto>
        {...TABLE_PROPS}
        rowKey={(r) => r.id}
        columns={columns}
        dataSource={rows}
        locale={{
          emptyText: params.search ? (
            <EmptyState message={`No jobs match “${params.search}”.`} />
          ) : (
            <EmptyState
              message="No jobs yet."
              hint="Jobs appear here as your app produces them — here's how to add one."
              docsHref={DOCS.producing}
              docsLabel="Producing jobs"
            />
          ),
        }}
        rowSelection={cappedRowSelection({
          rows,
          keyOf: (r) => r.id,
          selected,
          onChange: setSelected,
          max: config.maxBatchIds,
          hint: `You can act on ${config.maxBatchIds} jobs at a time — the limit is what one database statement can carry. Clear a selection to pick another.`,
        })}
      />
    </TableCard>
  );
}
