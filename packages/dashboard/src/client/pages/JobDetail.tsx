/**
 * Job detail page: full record, lifecycle timeline (every job), and actions —
 * retry (re-arm the job), clone (prefilled add form), remove, cancel. Terminal
 * records refetch on-demand rather than on the 30s poll.
 */
import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Content,
  Inline,
  PageHeader,
  Popconfirm,
  Row,
  Skeleton,
  Stack,
  StatusTag,
  Title,
} from '@portqueue/ui';
import styled from 'styled-components';
import { JobStatus } from '../queries/enums';
import type { JobDto } from '../../shared/dto';
import { api, config } from '../queries/api';
import { useQuery } from '../queries/use-poll';
import { useAction } from '../queries/use-action';
import { ACTIONS_CONFIG, STALLED, statusLabel } from '../constants/labels';
import { LifecycleTimeline } from '../components/LifecycleTimeline';
import { AddJobForm } from '../components/AddJobForm';
import { formatDate, truncate } from '../components/format';

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

const Pre = styled.pre<{ $danger?: boolean }>`
  margin: 0;
  padding: ${(p) => p.theme.space(3)};
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  font-family: ${(p) => p.theme.font.mono};
  color: ${(p) => (p.$danger ? p.theme.color.danger : p.theme.color.text)};
`;

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

export function JobDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const jobId = decodeURIComponent(id);
  const { run } = useAction();

  const job = useQuery<JobDto>(() => api.getJob(jobId), [jobId]);

  const [cloneOpen, setCloneOpen] = useState(false);

  if (job.error) {
    return (
      <>
        <PageHeader title="Job not found" subtitle="This job id is not in the database." />
        <Content>
          <Card>
            <Link to="/">Back to overview</Link>
          </Card>
        </Content>
      </>
    );
  }
  if (job.loading && !job.data) {
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

  const actions = !config.readOnly ? (
    <Inline gap={2} wrap>
      <Button
        icon={ACTIONS_CONFIG.retry.icon}
        disabled={!isFailed && j.status === JobStatus.ACTIVE}
        onClick={() => void run({ kind: 'retry', queue: j.queue, jobId: j.id }, 'Retry queued')}
      >
        {ACTIONS_CONFIG.retry.label}
      </Button>
      <Button icon={ACTIONS_CONFIG.clone.icon} onClick={() => setCloneOpen(true)}>
        {ACTIONS_CONFIG.clone.label}
      </Button>
      {j.status === JobStatus.ACTIVE && (
        <Popconfirm
          title="Cancel this job?"
          onConfirm={() => void run({ kind: 'cancel', queue: j.queue, jobId: j.id }, 'Cancelled')}
        >
          <Button icon={ACTIONS_CONFIG.cancel.icon}>{ACTIONS_CONFIG.cancel.label}</Button>
        </Popconfirm>
      )}
      <Popconfirm
        title="Remove this job permanently?"
        okDanger
        onConfirm={() => void run({ kind: 'remove', queue: j.queue, jobId: j.id }, 'Removed')}
      >
        <Button variant="danger" icon={ACTIONS_CONFIG.remove.icon}>
          {ACTIONS_CONFIG.remove.label}
        </Button>
      </Popconfirm>
    </Inline>
  ) : undefined;

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
            <Link to={`/queues/${encodeURIComponent(j.queue)}`}>{j.queue}</Link>
          </Inline>
        }
        extra={actions}
      />
      <Content>
        <Row gutter={16}>
          <Col span={14}>
            <Card title="Record">
              <DescGrid>
                <Item label="Status">{status}</Item>
                <Item label="Priority">{j.priority}</Item>
                <Item label="Attempts">
                  {j.retryAttempt} / {j.retryMaxAttempts}
                </Item>
                <Item label="Processed on instance">{j.processedOnInstanceKey ?? '—'}</Item>
                <Item label="Preferred instance pattern">
                  {j.preferredInstanceKeyPattern ?? '—'}
                </Item>
                <Item label="Created">{formatDate(j.createdAt)}</Item>
                <Item label="Start after">{formatDate(j.startAfter)}</Item>
                <Item label="Idempotency key">{j.idempotencyKey ?? '—'}</Item>
                <Item label="Schedule">
                  {j.scheduleId ? <Link to={`/schedules`}>{j.scheduleId}</Link> : '—'}
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
                <Pre>{JSON.stringify(j.data, null, 2)}</Pre>
              </InnerCard>
              {j.returnValue !== undefined && j.returnValue !== null && (
                <InnerCard>
                  <InnerCardTitle>Return value</InnerCardTitle>
                  <Pre>{JSON.stringify(j.returnValue, null, 2)}</Pre>
                </InnerCard>
              )}
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
      />
    </>
  );
}
