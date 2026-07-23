/**
 * Reusable jobs table with cursor paging, status filter, row selection + bulk actions.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import {
  Button,
  Inline,
  Popconfirm,
  SkeletonText,
  Stack,
  StatusTag,
  Text,
  Table,
  Tooltip,
} from '@portqueue/ui';
import type { TableColumn } from '@portqueue/ui';
import { JobStatus } from '../queries/enums';
import type { JobDto } from '../../shared/dto';
import { config } from '../queries/api';
import { relativeTime, truncate } from './format';
import { useAction } from '../queries/use-action';

export interface JobsTableProps {
  queue: string;
  jobs: JobDto[];
  loading: boolean;
  statuses: JobStatus[];
  onStatusesChange: (s: JobStatus[]) => void;
  hasMore: boolean;
  onNext: () => void;
  onPrev: () => void;
  canPrev: boolean;
  onRefresh: () => void;
}

const MonoLink = styled(Link)`
  font-family: ui-monospace, monospace;
  font-size: 12px;
`;

const TableScroll = styled.div`
  width: 100%;
  overflow-x: auto;
`;

export function JobsTable(props: JobsTableProps): React.ReactElement {
  const { run } = useAction();
  const [selected, setSelected] = useState<string[]>([]);
  const readOnly = config.readOnly;

  const toggleRow = (id: string): void => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const columns: TableColumn<JobDto>[] = [
    ...(readOnly
      ? []
      : [
          {
            title: '',
            key: 'select',
            width: 40,
            render: (r: JobDto) => (
              <input
                type="checkbox"
                checked={selected.includes(r.id)}
                onChange={() => toggleRow(r.id)}
                aria-label={`Select job ${r.id}`}
              />
            ),
          } satisfies TableColumn<JobDto>,
        ]),
    {
      title: 'Job',
      dataIndex: 'id',
      key: 'id',
      render: (r) => (
        <MonoLink to={`/jobs/${encodeURIComponent(r.id)}`}>{truncate(r.id)}</MonoLink>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (r) => <StatusTag status={r.status} />,
    },
    {
      title: 'Attempt',
      key: 'attempt',
      render: (r) => `${r.retryAttempt}/${r.retryMaxAttempts}`,
    },
    { title: 'Priority', dataIndex: 'priority', key: 'priority' },
    {
      title: 'Instance',
      key: 'instance',
      render: (r) =>
        r.processedOnInstanceKey ? (
          <Tooltip title={r.processedOnInstanceKey}>
            <span>{truncate(r.processedOnInstanceKey, 6, 4)}</span>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (r) => relativeTime(r.createdAt),
    },
  ];

  const doBulk = async (kind: 'retry' | 'remove' | 'cancel'): Promise<void> => {
    const jobIds = [...selected];
    if (kind === 'remove') {
      await run({ kind: 'remove', queue: props.queue, jobIds }, `Removed ${jobIds.length} job(s)`);
    } else {
      // retry/cancel are per-job in core; fan out.
      for (const jobId of jobIds) await run({ kind, queue: props.queue, jobId });
    }
    setSelected([]);
  };

  const toggleStatus = (s: JobStatus): void => {
    props.onStatusesChange(
      props.statuses.includes(s)
        ? props.statuses.filter((x) => x !== s)
        : [...props.statuses, s],
    );
  };

  return (
    <Stack gap={3}>
      <Inline wrap justify="space-between" align="center">
        <Inline wrap gap={2} align="center">
          {Object.values(JobStatus).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={props.statuses.includes(s) ? 'primary' : 'default'}
              onClick={() => toggleStatus(s)}
            >
              {s}
            </Button>
          ))}
          <Button icon="🔄" onClick={props.onRefresh}>
            Refresh
          </Button>
        </Inline>
        {!readOnly && selected.length > 0 && (
          <Inline wrap gap={2} align="center">
            <Text $tone="muted">{selected.length} selected</Text>
            <Button size="sm" onClick={() => void doBulk('retry')}>
              Retry
            </Button>
            <Button size="sm" onClick={() => void doBulk('cancel')}>
              Cancel
            </Button>
            <Popconfirm
              title="Remove selected jobs?"
              okText="Remove"
              okDanger
              onConfirm={() => void doBulk('remove')}
            >
              <Button size="sm" variant="danger">
                Remove
              </Button>
            </Popconfirm>
          </Inline>
        )}
      </Inline>

      {props.loading ? (
        <SkeletonText rows={6} />
      ) : (
        <TableScroll>
          <Table<JobDto> rowKey={(r) => r.id} size="md" columns={columns} data={props.jobs} />
        </TableScroll>
      )}

      <Inline justify="flex-end" gap={2}>
        <Button disabled={!props.canPrev} onClick={props.onPrev}>
          Previous
        </Button>
        <Button disabled={!props.hasMore} onClick={props.onNext}>
          Next
        </Button>
      </Inline>
    </Stack>
  );
}
