/**
 * Job detail page: the full record (payloads and every timestamp) beside the lifecycle timeline,
 * plus actions — retry (re-arm the job), clone (prefilled add form), remove, cancel.
 *
 * A job that is still in flight polls; a settled one doesn't. Its row can't change again once it
 * has reached a terminal status, so there is nothing to reconcile — but an ACTIVE or RETRY job
 * used to sit frozen here too, which was simply wrong.
 *
 * Two of the actions leave the page, because after them this URL no longer shows what the user
 * asked for: a clone follows the record it just created, and a removal goes back to the queue,
 * since the removed job's own page has nothing left to render.
 */
import React, { useEffect, useState } from 'react';
import { Link, useHistory, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Content,
  Inline,
  Mono,
  PageHeader,
  Popconfirm,
  Row,
  Skeleton,
  Stack,
  StatusTag,
  Title,
  useToast,
} from '@portqueue/ui';
import styled from 'styled-components';
import { JobStatus } from '../queries/enums';
import type { JobDto } from '../../shared/dto';
import { ActionKind } from '../../shared/dto';
import { api } from '../queries/api';
import { queryKeys, usePolledQuery, useOneShotQuery } from '../queries/use-queries';
import { useAction } from '../queries/use-action';
import { ACTIONS_CONFIG, STALLED, statusLabel } from '../constants/labels';
import { LifecycleTimeline } from '../components/LifecycleTimeline';
import { AddJobForm } from '../components/AddJobForm';
import { ErrorState } from '../components/states';
import { Time } from '../components/Time';
import { truncate } from '../components/format';

/**
 * Statuses a job can never leave. Everything else — PENDING, ACTIVE, RETRY — can still change
 * underneath the page, so those keep polling.
 */
const TERMINAL: string[] = [
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
  JobStatus.EXPIRED,
];

const MonoTitle = styled(Title)`
  font-family: ${(p) => p.theme.font.mono};
`;

const DescGrid = styled.dl`
  display: grid;
  grid-template-columns: 1fr;
  gap: ${(p) => p.theme.space(3)};
  margin: 0;
  @media (min-width: 480px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const DescLabel = styled.dt`
  font-size: 12px;
  color: ${(p) => p.theme.color.textMuted};
  margin-bottom: 2px;
`;

const DescValue = styled.dd`
  margin: 0;
  font-size: 14px;
  color: ${(p) => p.theme.color.text};
  word-break: break-word;
`;

const InnerCard = styled.div`
  margin-top: ${(p) => p.theme.space(4)};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radii.md}px;
  overflow: hidden;
`;

const InnerCardTitle = styled.div`
  padding: ${(p) => p.theme.space(2)} ${(p) => p.theme.space(3)};
  font-size: 13px;
  font-weight: 600;
  color: ${(p) => p.theme.color.text};
  background: ${(p) => p.theme.color.surfaceAlt};
  border-bottom: 1px solid ${(p) => p.theme.color.border};
`;

const InnerCardBody = styled.div`
  padding: ${(p) => p.theme.space(3)};
`;

const Pre = styled.pre<{ $danger?: boolean }>`
  margin: 0;
  padding: ${(p) => p.theme.space(3)};
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  font-family: ${(p) => p.theme.font.mono};
  color: ${(p) => (p.$danger ? p.theme.color.danger : p.theme.color.text)};
`;

/**
 * Every timestamp a job row carries, in lifecycle order. The section lists all of them — including
 * the ones that never happened — so "did this job ever stall / get cancelled?" is answerable from
 * the page, which the timeline alone can't do (it only plots the events that fired).
 */
const TIMESTAMPS: { key: Extract<keyof JobDto, `${string}At` | 'startAfter'>; label: string }[] = [
  { key: 'createdAt', label: 'Created at' },
  { key: 'startAfter', label: 'Start after' },
  { key: 'startedAt', label: 'Started at' },
  { key: 'retriedAt', label: 'Retried at' },
  { key: 'stalledAt', label: 'Stalled at' },
  { key: 'completedAt', label: 'Completed at' },
  { key: 'failedAt', label: 'Failed at' },
  { key: 'cancelledAt', label: 'Cancelled at' },
  { key: 'expiredAt', label: 'Expired at' },
  { key: 'updatedAt', label: 'Updated at' },
];

function Item({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <DescLabel>{label}</DescLabel>
      <DescValue>{children}</DescValue>
    </div>
  );
}

/**
 * A value that may be absent — renders the em dash the rest of the UI uses for "nothing". Given
 * `to`, it links the value to the page for the record it names, which is where a reader who
 * recognises an instance key or a schedule id wants to go next.
 */
function Maybe({
  value,
  to,
}: {
  value: string | null | undefined;
  to?: (value: string) => string;
}): React.ReactElement {
  if (!value) return <>—</>;
  return to ? (
    <Link to={to(value)}>
      <Mono>{value}</Mono>
    </Link>
  ) : (
    <Mono>{value}</Mono>
  );
}

/**
 * `data` and `returnValue` are `unknown` on the wire: pretty-print anything structured, and show
 * a scalar (string, number, boolean) as itself rather than as a quoted JSON literal.
 */
function formatPayload(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function JobDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const jobId = decodeURIComponent(id);
  const { run } = useAction();
  const history = useHistory();
  const toast = useToast();

  // Poll only while the record can still change. TanStack keeps the previous data across the
  // switch, so a job settling mid-view simply stops refetching rather than remounting.
  const [terminal, setTerminal] = useState(false);
  const polled = usePolledQuery<JobDto>(queryKeys.job(jobId), () => api.getJob(jobId));
  const once = useOneShotQuery<JobDto>(queryKeys.job(jobId), () => api.getJob(jobId));
  const job = terminal ? once : polled;

  const [cloneOpen, setCloneOpen] = useState(false);

  // A settled job needs no further reconciliation; stop the interval the moment it settles. Keyed
  // on the id too: this page stays mounted when it navigates to another job (a clone does exactly
  // that), and the previous job's terminal status must not leave the new one frozen.
  useEffect(() => {
    const status = job.data?.status;
    setTerminal(status !== undefined && TERMINAL.includes(status));
  }, [jobId, job.data?.status]);

  if (job.error) {
    return (
      <>
        <PageHeader title="Job" subtitle="This job could not be loaded." />
        <Content>
          <Stack gap={3}>
            <ErrorState
              title="Could not load this job"
              error={job.error}
              onRetry={() => void job.refetch()}
            />
            <Link to="/">Back to overview</Link>
          </Stack>
        </Content>
      </>
    );
  }
  if (job.isLoading && !job.data) {
    return (
      <>
        <PageHeader title="Job" subtitle="Loading the record…" />
        <Content>
          <Card>
            <Stack gap={3}>
              <Skeleton height={18} width="40%" />
              <Skeleton height={120} />
            </Stack>
          </Card>
        </Content>
      </>
    );
  }
  const j = job.data;
  if (!j) {
    return (
      <Content>
        <Card>
          <Skeleton height={120} />
        </Card>
      </Content>
    );
  }

  const isFailed = j.status === JobStatus.FAILED;
  const rawStatus = j.stalled ? STALLED : j.status;
  const status = statusLabel(rawStatus);
  const queuePath = `/queues/${encodeURIComponent(j.queue)}`;

  /**
   * Remove this job, then leave for its queue — there is no record left to show here. The outcome
   * is reported from the result rather than assumed: core refuses to remove a **running** job, and
   * that refusal has to keep the user on the page instead of sending them off with "Removed".
   */
  const remove = async (): Promise<void> => {
    const result = await run({ kind: ActionKind.REMOVE, queue: j.queue, jobId: j.id }, undefined, {
      silent: true,
    });
    if (!result) return;
    if (!result.ok) {
      toast.info('This job is still running. Cancel it first, then remove it.');
      return;
    }
    toast.success('Removed');
    history.push(queuePath);
  };

  const actions = (
    <Inline gap={2} wrap>
      <Button
        icon={ACTIONS_CONFIG.retry.icon}
        disabled={!isFailed && j.status === JobStatus.ACTIVE}
        onClick={() =>
          void run({ kind: ActionKind.RETRY, queue: j.queue, jobId: j.id }, 'Retry queued')
        }
      >
        {ACTIONS_CONFIG.retry.label}
      </Button>
      <Button icon={ACTIONS_CONFIG.clone.icon} onClick={() => setCloneOpen(true)}>
        {ACTIONS_CONFIG.clone.label}
      </Button>
      {j.status === JobStatus.ACTIVE && (
        <Popconfirm
          title="Cancel this job?"
          // Labelled with the action, as the row popovers are: a bare "OK" next to "Cancel" reads
          // as if the dismiss button were the one that cancels the job.
          okText={ACTIONS_CONFIG.cancel.label}
          cancelText="Keep"
          onConfirm={() =>
            void run({ kind: ActionKind.CANCEL, queue: j.queue, jobId: j.id }, 'Cancelled')
          }
        >
          <Button icon={ACTIONS_CONFIG.cancel.icon}>{ACTIONS_CONFIG.cancel.label}</Button>
        </Popconfirm>
      )}
      <Popconfirm
        title="Remove this job permanently?"
        okText={ACTIONS_CONFIG.remove.label}
        cancelText="Keep"
        okDanger
        onConfirm={() => void remove()}
      >
        <Button variant="danger" icon={ACTIONS_CONFIG.remove.icon}>
          {ACTIONS_CONFIG.remove.label}
        </Button>
      </Popconfirm>
    </Inline>
  );

  return (
    <>
      <PageHeader
        title={
          <Inline gap={3} align="center" wrap>
            <MonoTitle level={4} as="span">
              {truncate(j.id, 14, 8)}
            </MonoTitle>
            <Button
              size="sm"
              variant="text"
              icon={ACTIONS_CONFIG.copy.icon}
              onClick={() => void navigator.clipboard?.writeText(j.id)}
              aria-label="Copy job id"
            />
          </Inline>
        }
        subtitle={
          <Inline gap={2} align="center">
            <StatusTag status={rawStatus} label={status} />
            <Link to={queuePath}>{j.queue}</Link>
          </Inline>
        }
        extra={actions}
      />
      <Content>
        <Row gutter={16}>
          <Col span={14}>
            <Card title="Details">
              <DescGrid>
                <Item label="Job id">
                  <Mono>{j.id}</Mono>
                </Item>
                <Item label="Queue">
                  <Link to={queuePath}>{j.queue}</Link>
                </Item>
                <Item label="Status">{status}</Item>
                <Item label="Stalled">{j.stalled ? 'Yes' : 'No'}</Item>
                <Item label="Priority">{j.priority}</Item>
                <Item label="Attempts">
                  {j.retryAttempt} / {j.retryMaxAttempts}
                </Item>
                <Item label="Processed on instance">
                  <Maybe
                    value={j.processedOnInstanceKey}
                    to={(v) => `/instances/${encodeURIComponent(v)}`}
                  />
                </Item>
                <Item label="Preferred instance pattern">
                  <Maybe value={j.preferredInstanceKeyPattern} />
                </Item>
                <Item label="Locked until">
                  <Time value={j.lockedUntil} />
                </Item>
                <Item label="Idempotency key">
                  <Maybe value={j.idempotencyKey} />
                </Item>
                <Item label="Schedule">
                  {/* Straight to that schedule's own page, which lists the jobs it produced —
                      the bare schedules list answered nothing about this job. */}
                  <Maybe value={j.scheduleId} to={(v) => `/schedules/${encodeURIComponent(v)}`} />
                </Item>
              </DescGrid>
              {j.failureMessage && (
                <InnerCard>
                  <InnerCardTitle>Failure message</InnerCardTitle>
                  <Pre $danger>{j.failureMessage}</Pre>
                </InnerCard>
              )}
              <InnerCard>
                <InnerCardTitle>Data</InnerCardTitle>
                <Pre>{formatPayload(j.data)}</Pre>
              </InnerCard>
              <InnerCard>
                <InnerCardTitle>Return value</InnerCardTitle>
                <Pre>{formatPayload(j.returnValue)}</Pre>
              </InnerCard>
              <InnerCard>
                <InnerCardTitle>Timestamps</InnerCardTitle>
                <InnerCardBody>
                  <DescGrid>
                    {TIMESTAMPS.map((t) => (
                      <Item key={t.key} label={t.label}>
                        <Time value={j[t.key]} />
                      </Item>
                    ))}
                  </DescGrid>
                </InnerCardBody>
              </InnerCard>
            </Card>
          </Col>
          <Col span={10}>
            <Card title="Lifecycle">
              <LifecycleTimeline job={j} />
            </Card>
          </Col>
        </Row>
      </Content>

      <AddJobForm
        open={cloneOpen}
        queue={j.queue}
        onClose={() => setCloneOpen(false)}
        initial={{ data: j.data, priority: j.priority }}
        // Follow what the clone produced: a one-off job has its own detail page, and the modal's
        // Recurring mode creates a schedule instead, which has one too.
        onCreated={(result) => {
          if (result.jobId) history.push(`/jobs/${encodeURIComponent(result.jobId)}`);
          else if (result.scheduleId) {
            history.push(`/schedules/${encodeURIComponent(result.scheduleId)}`);
          }
        }}
      />
    </>
  );
}
