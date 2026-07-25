/**
 * The jobs table for a queue: server-paged (20 rows a page) with the page, the search term and
 * the status filter all held in the URL. Rows are selectable for bulk retry / cancel / remove,
 * and every row carries the same three actions as icon buttons.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { Mono, StatusTag, Table, Text, Tooltip } from '@portqueue/ui';
import type { DropdownItem, TableColumn } from '@portqueue/ui';
import { JobStatus } from '../queries/enums';
import type { JobDto, JobPageDto } from '../../shared/dto';
import { api, config } from '../queries/api';
import { usePoll } from '../queries/use-poll';
import { useAction } from '../queries/use-action';
import { PAGE_SIZE, useTableParams } from '../queries/use-table-params';
import { ACTIONS_CONFIG, STALLED, STATUSES_CONFIG, statusLabel } from '../constants/labels';
import { JOB_SEARCH_SCAN_LIMIT } from '../../shared/constants';
import { relativeTime, truncate } from './format';
import { TableCard } from './TableCard';
import type { FilterDef } from './FiltersModal';
import { BulkActionsButton, ConfirmModal, RowAction, RowActions } from './RowActions';

export interface JobsTableProps {
  queue: string;
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
    multiple: true,
    options: Object.values(JobStatus).map((s) => ({ label: STATUSES_CONFIG[s].label, value: s })),
  },
];

/** A job can be cancelled while it is still on its way through the queue. */
const CANCELLABLE: JobStatus[] = [JobStatus.PENDING, JobStatus.ACTIVE, JobStatus.RETRY];

export function JobsTable({ queue }: JobsTableProps): React.ReactElement {
  const { run, refresh } = useAction();
  const readOnly = config.readOnly;
  const params = useTableParams('jobs', FILTER_KEYS);
  const statusesKey = (params.filters.status ?? []).join(',');

  const [selected, setSelected] = useState<string[]>([]);
  const [confirmBulkRemove, setConfirmBulkRemove] = useState(false);

  const jobs = usePoll<JobPageDto>(
    () =>
      api.getJobs({
        queue,
        statuses: statusesKey || undefined,
        search: params.search || undefined,
        offset: String(params.offset),
        limit: String(PAGE_SIZE),
        order: 'desc',
      }),
    [queue, statusesKey, params.search, params.offset],
  );

  const rows = jobs.data?.items ?? [];

  // A different page / filter / search means a different row set; drop the stale selection.
  useEffect(() => setSelected([]), [queue, statusesKey, params.search, params.offset]);

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
      render: (r) =>
        r.processedOnInstanceKey ? (
          <Tooltip title={r.processedOnInstanceKey} placement="bottom">
            <Mono>{truncate(r.processedOnInstanceKey, 8, 4)}</Mono>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      title: 'Created At',
      key: 'createdAt',
      render: (r) => relativeTime(r.createdAt),
    },
    {
      title: 'Start After',
      key: 'startAfter',
      render: (r) => relativeTime(r.startAfter),
    },
    {
      title: 'Completed At',
      key: 'completedAt',
      render: (r) => relativeTime(r.completedAt),
    },
    {
      title: 'Failed At',
      key: 'failedAt',
      render: (r) => relativeTime(r.failedAt),
    },
    ...(readOnly
      ? []
      : [
          {
            title: 'Actions',
            key: 'actions',
            align: 'right',
            render: (r: JobDto) => (
              <RowActions>
                <RowAction
                  icon={ACTIONS_CONFIG.retry.icon}
                  label={ACTIONS_CONFIG.retry.label}
                  disabled={r.status === JobStatus.ACTIVE}
                  onClick={() => void run({ kind: 'retry', queue, jobId: r.id }, 'Retry queued')}
                />
                <RowAction
                  icon={ACTIONS_CONFIG.cancel.icon}
                  label={ACTIONS_CONFIG.cancel.label}
                  disabled={!CANCELLABLE.includes(r.status as JobStatus)}
                  confirm={{ title: 'Cancel this job?' }}
                  onClick={() => void run({ kind: 'cancel', queue, jobId: r.id }, 'Cancelled')}
                />
                <RowAction
                  danger
                  icon={ACTIONS_CONFIG.remove.icon}
                  label={ACTIONS_CONFIG.remove.label}
                  confirm={{ title: 'Remove this job permanently?' }}
                  onClick={() => void run({ kind: 'remove', queue, jobId: r.id }, 'Removed')}
                />
              </RowActions>
            ),
          } satisfies TableColumn<JobDto>,
        ]),
  ];

  const runBulk = async (kind: 'retry' | 'remove' | 'cancel'): Promise<void> => {
    const jobIds = [...selected];
    if (kind === 'remove') {
      await run({ kind: 'remove', queue, jobIds }, `Removed ${jobIds.length} job(s)`);
    } else {
      // retry/cancel are per-job in core; fan out quietly, then refresh + report once.
      for (const jobId of jobIds) await run({ kind, queue, jobId }, undefined, { silent: true });
      refresh();
    }
    setSelected([]);
  };

  const bulkItems: DropdownItem[] = [
    {
      key: 'retry',
      label: `${ACTIONS_CONFIG.retry.label} selected`,
      icon: ACTIONS_CONFIG.retry.icon,
      onClick: () => void runBulk('retry'),
    },
    {
      key: 'cancel',
      label: `${ACTIONS_CONFIG.cancel.label} selected`,
      icon: ACTIONS_CONFIG.cancel.icon,
      onClick: () => void runBulk('cancel'),
    },
    {
      key: 'remove',
      label: `${ACTIONS_CONFIG.remove.label} selected`,
      icon: ACTIONS_CONFIG.remove.icon,
      danger: true,
      onClick: () => setConfirmBulkRemove(true),
    },
  ];

  const empty = params.search ? (
    <Text $tone="muted">No jobs match “{params.search}”.</Text>
  ) : undefined;

  return (
    <>
      <TableCard
        total={jobs.data?.total ?? 0}
        page={params.page}
        onPageChange={params.setPage}
        loading={jobs.loading && !jobs.data}
        paginationLabel="Jobs pagination"
        search={{
          value: params.search,
          onChange: params.setSearch,
          placeholder: 'Search job id or status',
        }}
        filters={{ defs: FILTER_DEFS, values: params.filters, onChange: params.setFilters }}
        toolbarLeading={<BulkActionsButton count={selected.length} items={bulkItems} />}
      >
        <Table<JobDto>
          rowKey={(r) => r.id}
          columns={columns}
          data={rows}
          empty={empty}
          {...(readOnly ? {} : { rowSelection: { selectedKeys: selected, onChange: setSelected } })}
        />
      </TableCard>

      {jobs.data?.searchTruncated ? (
        <Text $tone="muted">
          Search scanned the most recent {JOB_SEARCH_SCAN_LIMIT} jobs — narrow it with a status
          filter to reach older jobs.
        </Text>
      ) : null}

      <ConfirmModal
        open={confirmBulkRemove}
        title={`Remove ${selected.length} job(s)?`}
        description="This permanently deletes the selected job rows. It cannot be undone."
        okText={ACTIONS_CONFIG.remove.label}
        okDanger
        onClose={() => setConfirmBulkRemove(false)}
        onConfirm={() => void runBulk('remove')}
      />
    </>
  );
}
