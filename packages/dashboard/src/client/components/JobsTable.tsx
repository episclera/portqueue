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
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { StatusTag, Table, Tooltip } from '@portqueue/ui';
import type { DropdownItem, TableColumn } from '@portqueue/ui';
import { JobStatus } from '../queries/enums';
import { ActionKind, type JobDto, type JobPageDto } from '../../shared/dto';
import { api } from '../queries/api';
import { queryKeys, usePolledQuery } from '../queries/use-queries';
import { useAction } from '../queries/use-action';
import { PAGE_SIZE, clampedPage, useTableParams } from '../queries/use-table-params';
import { ACTIONS_CONFIG, STALLED, STATUSES_CONFIG, statusLabel } from '../constants/labels';
import { truncate } from './format';
import { dateColumn } from './table-columns';
import { TableCard } from './TableCard';
import { DOCS, EmptyState } from './states';
import type { FilterDef } from './FiltersModal';
import { BulkActionsButton, ConfirmModal, RowAction, RowActions } from './RowActions';

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

const MonoLink = styled(Link)`
  font-family: ${(p) => p.theme.font.mono};
  font-size: 12px;
`;

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
  const params = useTableParams(prefix, FILTER_KEYS);
  const statusesKey = (params.filters.status ?? []).join(',');

  const [selected, setSelected] = useState<string[]>([]);
  const [confirmBulkRemove, setConfirmBulkRemove] = useState(false);

  const listParams = {
    ...(queue ? { queue } : {}),
    ...(scheduleId ? { scheduleId } : {}),
    ...(instanceKey ? { instanceKey } : {}),
    ...(statusesKey ? { statuses: statusesKey } : {}),
    ...(params.search ? { search: params.search } : {}),
    offset: params.offset,
    limit: PAGE_SIZE,
    order: 'desc',
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

  const columns: TableColumn<JobDto>[] = [
    {
      title: 'Job',
      key: 'id',
      render: (r) => <MonoLink to={`/jobs/${encodeURIComponent(r.id)}`}>{truncate(r.id)}</MonoLink>,
    },
    {
      title: 'Status',
      key: 'status',
      render: (r) => {
        const status = r.stalled ? STALLED : r.status;
        return <StatusTag status={status} label={statusLabel(status)} />;
      },
    },
    {
      title: 'Attempt',
      key: 'attempt',
      render: (r) => `${r.retryAttempt}/${r.retryMaxAttempts}`,
    },
    { title: 'Priority', dataIndex: 'priority', key: 'priority' },
    {
      title: 'Processed On Instance',
      key: 'processedOnInstanceKey',
      // Linked: "what else was that process doing?" is the next question, one click away.
      render: (r) =>
        r.processedOnInstanceKey ? (
          <Tooltip title={r.processedOnInstanceKey} placement="bottom">
            <MonoLink to={`/instances/${encodeURIComponent(r.processedOnInstanceKey)}`}>
              {truncate(r.processedOnInstanceKey, 8, 4)}
            </MonoLink>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    dateColumn<JobDto>('Created At', 'createdAt', (r) => r.createdAt),
    dateColumn<JobDto>('Start After', 'startAfter', (r) => r.startAfter),
    dateColumn<JobDto>('Completed At', 'completedAt', (r) => r.completedAt),
    dateColumn<JobDto>('Failed At', 'failedAt', (r) => r.failedAt),
    {
      title: 'Actions',
      key: 'actions',
      // Buttons hug the right edge; the title stays on the left, where it reads as this column's.
      align: 'right',
      headerAlign: 'left',
      render: (r: JobDto) => (
        <RowActions>
          <RowAction
            icon={ACTIONS_CONFIG.retry.icon}
            label={ACTIONS_CONFIG.retry.label}
            disabled={r.status === JobStatus.ACTIVE}
            onClick={() =>
              void run({ kind: ActionKind.RETRY, queue: r.queue, jobId: r.id }, 'Retry queued')
            }
          />
          <RowAction
            icon={ACTIONS_CONFIG.cancel.icon}
            label={ACTIONS_CONFIG.cancel.label}
            disabled={!CANCELLABLE.includes(r.status as JobStatus)}
            confirm={{ title: 'Cancel this job?' }}
            onClick={() =>
              void run({ kind: ActionKind.CANCEL, queue: r.queue, jobId: r.id }, 'Cancelled')
            }
          />
          <RowAction
            danger
            icon={ACTIONS_CONFIG.remove.icon}
            label={ACTIONS_CONFIG.remove.label}
            confirm={{ title: 'Remove this job permanently?' }}
            onClick={() =>
              void run({ kind: ActionKind.REMOVE, queue: r.queue, jobId: r.id }, 'Removed')
            }
          />
        </RowActions>
      ),
    },
  ];

  /**
   * Every bulk action is one request carrying every id, applied in a single server-side
   * transaction. A batch that spans queues is grouped by queue, since each action names one.
   */
  const runBulk = async (kind: ActionKind, verb: string): Promise<void> => {
    const byQueue = new Map<string, string[]>();
    for (const row of rows) {
      if (!selected.includes(row.id)) continue;
      const list = byQueue.get(row.queue) ?? [];
      list.push(row.id);
      byQueue.set(row.queue, list);
    }
    for (const [queueName, jobIds] of byQueue) {
      await runBatch({ kind, queue: queueName, jobIds }, { verb, noun: 'job' });
    }
    setSelected([]);
  };

  const bulkItems: DropdownItem[] = [
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
      onClick: () => setConfirmBulkRemove(true),
    },
  ];

  return (
    <>
      <TableCard
        total={total}
        page={clampedPage(params.page, total)}
        onPageChange={params.setPage}
        loading={jobs.isLoading}
        error={jobs.error}
        errorTitle="Could not load jobs"
        onRetry={() => void jobs.refetch()}
        paginationLabel="Jobs pagination"
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
          rowKey={(r) => r.id}
          columns={columns}
          data={rows}
          empty={
            params.search ? (
              <EmptyState message={`No jobs match “${params.search}”.`} />
            ) : (
              <EmptyState
                message="No jobs yet."
                hint="Jobs appear here as your app produces them — here's how to add one."
                docsHref={DOCS.producing}
                docsLabel="Producing jobs"
              />
            )
          }
          rowSelection={{ selectedKeys: selected, onChange: setSelected }}
        />
      </TableCard>

      <ConfirmModal
        open={confirmBulkRemove}
        title={`Remove ${selected.length} job(s)?`}
        description="This permanently deletes the selected job rows. It cannot be undone."
        okText={ACTIONS_CONFIG.remove.label}
        okDanger
        onClose={() => setConfirmBulkRemove(false)}
        onConfirm={() => void runBulk(ActionKind.REMOVE, 'Removed')}
      />
    </>
  );
}
