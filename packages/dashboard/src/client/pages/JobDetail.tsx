/**
 * Job detail page: full record, lifecycle timeline (every job), workflow run
 * view (multi-step), and actions — retry (with RetryMode choice), clone (prefilled add form),
 * remove, cancel. Terminal records refetch on-demand rather than on the 30s poll.
 */
import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Dropdown,
  Inline,
  Popconfirm,
  Row,
  Skeleton,
  Stack,
  StatusTag,
  Text,
  Title,
} from '@portqueue/ui';
import styled from 'styled-components';
import { JobStatus, RetryMode } from '../queries/enums';
import type { JobDto, WorkflowDto } from '../../shared/dto';
import { api, config } from '../queries/api';
import { useQuery } from '../queries/use-poll';
import { useAction } from '../queries/use-action';
import { LifecycleTimeline } from '../components/LifecycleTimeline';
import { WorkflowView } from '../components/WorkflowView';
import { AddJobForm } from '../components/AddJobForm';
import { formatDate } from '../components/format';

const MonoTitle = styled(Title)`
  font-family: ui-monospace, monospace;
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

function Item({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
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
  const workflowId = job.data?.workflowId ?? undefined;
  const workflow = useQuery<WorkflowDto | undefined>(
    () => (workflowId ? api.getWorkflow(workflowId) : Promise.resolve(undefined)),
    [workflowId],
  );

  const [cloneOpen, setCloneOpen] = useState(false);

  if (job.error) {
    return (
      <Card>
        <Stack gap={3} align="center">
          <Title level={3}>Job not found</Title>
          <Link to="/">Back to overview</Link>
        </Stack>
      </Card>
    );
  }
  if (job.loading && !job.data) {
    return (
      <Card>
        <Skeleton height={120} />
      </Card>
    );
  }
  const j = job.data;
  if (!j) return <Skeleton height={120} />;

  const isWorkflow = Boolean(j.workflowId);
  const isFailed = j.status === JobStatus.FAILED;

  return (
    <Stack gap={6}>
      <Inline justify="space-between" align="center" wrap style={{ width: '100%' }}>
        <Inline gap={3} align="center" wrap>
          <MonoTitle level={4}>{j.id}</MonoTitle>
          <Button
            size="sm"
            variant="text"
            icon="📋"
            onClick={() => void navigator.clipboard?.writeText(j.id)}
            aria-label="Copy job id"
          />
          <StatusTag status={j.stalled ? 'STALLED' : j.status} />
          <Link to={`/queues/${encodeURIComponent(j.queue)}`}>{j.queue}</Link>
        </Inline>
        {!config.readOnly && (
          <Inline gap={2} wrap>
            {isWorkflow ? (
              <Dropdown
                items={[
                  {
                    key: RetryMode.FROM_FAILED_STEP,
                    label: 'From failed step (resume)',
                    onClick: () =>
                      void run(
                        {
                          kind: 'retry',
                          queue: j.queue,
                          jobId: j.id,
                          from: RetryMode.FROM_FAILED_STEP,
                        },
                        'Retry queued',
                      ),
                  },
                  {
                    key: RetryMode.FROM_START,
                    label: 'From start (fresh run)',
                    onClick: () =>
                      void run(
                        { kind: 'retry', queue: j.queue, jobId: j.id, from: RetryMode.FROM_START },
                        'Retry queued',
                      ),
                  },
                ]}
              >
                <Button>Retry ▾</Button>
              </Dropdown>
            ) : (
              <Button
                disabled={!isFailed && j.status === JobStatus.ACTIVE}
                onClick={() =>
                  void run(
                    { kind: 'retry', queue: j.queue, jobId: j.id, from: RetryMode.FROM_START },
                    'Retry queued',
                  )
                }
              >
                Retry
              </Button>
            )}
            <Button onClick={() => setCloneOpen(true)}>Clone</Button>
            {j.status === JobStatus.ACTIVE && (
              <Popconfirm
                title="Cancel this job?"
                onConfirm={() =>
                  void run({ kind: 'cancel', queue: j.queue, jobId: j.id }, 'Cancelled')
                }
              >
                <Button>Cancel</Button>
              </Popconfirm>
            )}
            <Popconfirm
              title="Remove this job permanently?"
              okDanger
              onConfirm={() => void run({ kind: 'remove', queue: j.queue, jobId: j.id }, 'Removed')}
            >
              <Button variant="danger">Remove</Button>
            </Popconfirm>
          </Inline>
        )}
      </Inline>

      <Row gutter={16}>
        <Col span={14}>
          <Card title="Record">
            <DescGrid>
              <Item label="Status">{j.stalled ? 'STALLED' : j.status}</Item>
              <Item label="Priority">{j.priority}</Item>
              <Item label="Attempts">
                {j.retryAttempt} / {j.retryMaxAttempts}
              </Item>
              <Item label="Instance">{j.processedOnInstanceKey ?? '—'}</Item>
              <Item label="Created">{formatDate(j.createdAt)}</Item>
              <Item label="Start after">{formatDate(j.startAfter)}</Item>
              <Item label="Idempotency key">{j.idempotencyKey ?? '—'}</Item>
              <Item label="Schedule">
                {j.scheduleId ? <Link to={`/schedules`}>{j.scheduleId}</Link> : '—'}
              </Item>
              {j.workflowStepKey && <Item label="Step">{j.workflowStepKey}</Item>}
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

      {isWorkflow && (
        <Card title="Workflow run">
          {workflow.loading && !workflow.data ? (
            <Skeleton height={80} />
          ) : workflow.data ? (
            <WorkflowView workflow={workflow.data} />
          ) : (
            <Text $tone="muted">No workflow steps found.</Text>
          )}
        </Card>
      )}

      <AddJobForm
        open={cloneOpen}
        queue={j.queue}
        onClose={() => setCloneOpen(false)}
        initial={{ data: j.data, priority: j.priority }}
      />
    </Stack>
  );
}
