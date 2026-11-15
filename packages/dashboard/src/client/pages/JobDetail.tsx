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
import { useHistory, useParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Popconfirm,
  Row,
  Skeleton,
  Typography,
  theme,
} from 'antd';
import type { DescriptionsProps } from 'antd';
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
import { StatusTag } from '../components/StatusTag';
import { PageBody, PageHeader } from '../components/layout';
import { AppLink } from '../components/AppLink';
import { FlagTag } from '../components/StateTags';

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

/**
 * The Lifecycle card's fixed width beside Details on wide screens: a timeline is a narrow column of
 * labels and timestamps, so a share of the row only added empty space; Details takes the rest.
 */
const LIFECYCLE_CARD_WIDTH = 360;

/** Two columns from `sm` up, one on a phone. */
const DESCRIPTION_COLUMNS = { xs: 1, sm: 2 };

/** A monospaced value — ids, keys, patterns. */
const Mono = ({ children }: { children: React.ReactNode }): React.ReactElement => (
  <Typography.Text code>{children}</Typography.Text>
);

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
  // A value that leads somewhere is a link, never a code chip — see `AppLink`.
  return to ? <AppLink to={to(value)}>{value}</AppLink> : <Mono>{value}</Mono>;
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
  const { message: toast } = App.useApp();
  const { token } = theme.useToken();

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
        <PageHeader entity="Job" title={jobId} subtitle="This job could not be loaded." />
        <PageBody>
          <ErrorState
            title="Could not load this job"
            error={job.error}
            onRetry={() => void job.refetch()}
          />
          <AppLink to="/">Back to overview</AppLink>
        </PageBody>
      </>
    );
  }
  if (job.isLoading && !job.data) {
    return (
      <>
        <PageHeader entity="Job" title={jobId} subtitle="Loading the record…" />
        <PageBody>
          <Card>
            <Skeleton active paragraph={{ rows: 6 }} />
          </Card>
        </PageBody>
      </>
    );
  }
  const j = job.data;
  if (!j) {
    return (
      <PageBody>
        <Card>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      </PageBody>
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
    const result = await run({ kind: ActionKind.REMOVE, jobId: j.id }, undefined, {
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
    <Flex gap="small" wrap>
      <Button
        icon={ACTIONS_CONFIG.retry.icon}
        disabled={!isFailed && j.status === JobStatus.ACTIVE}
        onClick={() => void run({ kind: ActionKind.RETRY, jobId: j.id }, 'Retry queued')}
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
          onConfirm={() => void run({ kind: ActionKind.CANCEL, jobId: j.id }, 'Cancelled')}
        >
          <Button icon={ACTIONS_CONFIG.cancel.icon}>{ACTIONS_CONFIG.cancel.label}</Button>
        </Popconfirm>
      )}
      <Popconfirm
        title="Remove this job permanently?"
        okText={ACTIONS_CONFIG.remove.label}
        cancelText="Keep"
        okButtonProps={{ danger: true }}
        onConfirm={() => void remove()}
      >
        <Button danger icon={ACTIONS_CONFIG.remove.icon}>
          {ACTIONS_CONFIG.remove.label}
        </Button>
      </Popconfirm>
    </Flex>
  );

  const details: DescriptionsProps['items'] = [
    { key: 'id', label: 'Job id', children: <Mono>{j.id}</Mono> },
    { key: 'queue', label: 'Queue', children: <AppLink to={queuePath}>{j.queue}</AppLink> },
    { key: 'status', label: 'Status', children: <StatusTag status={rawStatus} label={status} /> },
    { key: 'stalled', label: 'Stalled', children: <FlagTag on={j.stalled} /> },
    { key: 'priority', label: 'Priority', children: j.priority },
    {
      key: 'attempts',
      label: 'Attempts',
      children: `${j.retryAttempt} / ${j.retryMaxAttempts}`,
    },
    {
      key: 'instance',
      label: 'Processed on instance',
      children: (
        <Maybe value={j.processedOnInstanceKey} to={(v) => `/instances/${encodeURIComponent(v)}`} />
      ),
    },
    {
      key: 'pattern',
      label: 'Preferred instance pattern',
      children: <Maybe value={j.preferredInstanceKeyPattern} />,
    },
    { key: 'lockedUntil', label: 'Locked until', children: <Time value={j.lockedUntil} /> },
    { key: 'idempotency', label: 'Idempotency key', children: <Maybe value={j.idempotencyKey} /> },
    {
      key: 'schedule',
      label: 'Schedule',
      // Straight to that schedule's own page, which lists the jobs it produced — the bare schedules
      // list answered nothing about this job.
      children: <Maybe value={j.scheduleId} to={(v) => `/schedules/${encodeURIComponent(v)}`} />,
    },
  ];

  /** A payload or message block — monospaced, wrapped, never wider than the card. */
  const pre = (text: string, danger = false): React.ReactElement => (
    <pre
      style={{
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: token.fontFamilyCode,
        fontSize: token.fontSizeSM,
        color: danger ? token.colorError : token.colorText,
      }}
    >
      {text}
    </pre>
  );

  return (
    <>
      <PageHeader
        entity="Job"
        title={j.id}
        tags={<StatusTag status={rawStatus} label={status} />}
        extra={actions}
      />
      <PageBody>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={{ flex: '1 1 0' }} style={{ minWidth: 0 }}>
            <Card title="Details">
              <Flex vertical gap="middle">
                <Descriptions column={DESCRIPTION_COLUMNS} items={details} />
                {j.failureMessage && (
                  <Card type="inner" size="small" title="Failure message">
                    {pre(j.failureMessage, true)}
                  </Card>
                )}
                <Card type="inner" size="small" title="Data">
                  {pre(formatPayload(j.data))}
                </Card>
                <Card type="inner" size="small" title="Return value">
                  {pre(formatPayload(j.returnValue))}
                </Card>
                <Card type="inner" size="small" title="Timestamps">
                  <Descriptions
                    column={DESCRIPTION_COLUMNS}
                    items={TIMESTAMPS.map((t) => ({
                      key: t.key,
                      label: t.label,
                      children: <Time value={j[t.key]} />,
                    }))}
                  />
                </Card>
              </Flex>
            </Card>
          </Col>
          <Col xs={24} lg={{ flex: `0 0 ${LIFECYCLE_CARD_WIDTH}px` }}>
            <Card title="Lifecycle">
              <LifecycleTimeline job={j} />
            </Card>
          </Col>
        </Row>
      </PageBody>

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
