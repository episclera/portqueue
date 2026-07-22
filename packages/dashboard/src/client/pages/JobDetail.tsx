/**
 * Job detail page (build_plan/12.4): full record, lifecycle timeline (every job), workflow run
 * view (multi-step), and actions — retry (with RetryMode choice), clone (prefilled add form),
 * remove, cancel. Terminal records refetch on-demand rather than on the 30s poll.
 */
import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Dropdown,
  Popconfirm,
  Result,
  Row,
  Skeleton,
  Space,
  Typography,
} from 'antd';
import { CopyOutlined, DownOutlined } from '@ant-design/icons';
import { JobStatus, RetryMode } from '../queries/enums.js';
import { StatusTag } from '@portqueue/ui';
import type { JobDto, WorkflowDto } from '../../shared/dto.js';
import { api, config } from '../queries/api.js';
import { useQuery } from '../queries/use-poll.js';
import { useAction } from '../queries/use-action.js';
import { LifecycleTimeline } from '../components/LifecycleTimeline.js';
import { WorkflowView } from '../components/WorkflowView.js';
import { AddJobForm } from '../components/AddJobForm.js';
import { useStyles } from '../components/styles.js';
import { formatDate } from '../components/format.js';

export function JobDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const jobId = decodeURIComponent(id);
  const { styles } = useStyles();
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
      <Result status="404" title="Job not found" extra={<Link to="/">Back to overview</Link>} />
    );
  }
  if (job.loading && !job.data) {
    return (
      <Card className={styles.card}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }
  const j = job.data;
  if (!j) return <Skeleton active />;

  const isWorkflow = Boolean(j.workflowId);
  const isFailed = j.status === JobStatus.FAILED;

  const retryMenu = {
    items: [
      { key: RetryMode.FROM_FAILED_STEP, label: 'From failed step (resume)' },
      { key: RetryMode.FROM_START, label: 'From start (fresh run)' },
    ],
    onClick: ({ key }: { key: string }) =>
      void run(
        { kind: 'retry', queue: j.queue, jobId: j.id, from: key as RetryMode },
        'Retry queued',
      ),
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
        <Space align="center" wrap>
          <Typography.Title level={4} style={{ margin: 0, fontFamily: 'ui-monospace, monospace' }}>
            {j.id}
          </Typography.Title>
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined />}
            onClick={() => void navigator.clipboard?.writeText(j.id)}
            aria-label="Copy job id"
          />
          <StatusTag status={j.stalled ? 'STALLED' : j.status} />
          <Link to={`/queues/${encodeURIComponent(j.queue)}`}>{j.queue}</Link>
        </Space>
        {!config.readOnly && (
          <Space wrap>
            {isWorkflow ? (
              <Dropdown menu={retryMenu}>
                <Button>
                  Retry <DownOutlined />
                </Button>
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
              onConfirm={() => void run({ kind: 'remove', queue: j.queue, jobId: j.id }, 'Removed')}
            >
              <Button danger>Remove</Button>
            </Popconfirm>
          </Space>
        )}
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card className={styles.card} title="Record">
            <Descriptions column={{ xs: 1, sm: 2 }} size="small">
              <Descriptions.Item label="Status">
                {j.stalled ? 'STALLED' : j.status}
              </Descriptions.Item>
              <Descriptions.Item label="Priority">{j.priority}</Descriptions.Item>
              <Descriptions.Item label="Attempts">
                {j.retryAttempt} / {j.retryMaxAttempts}
              </Descriptions.Item>
              <Descriptions.Item label="Instance">
                {j.runOnInstanceId
                  ? `${j.runOnInstanceId} (${j.runOnInstanceType ?? 'UNKNOWN'})`
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Created">{formatDate(j.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="Start after">{formatDate(j.startAfter)}</Descriptions.Item>
              <Descriptions.Item label="Idempotency key">
                {j.idempotencyKey ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Schedule">
                {j.scheduleId ? <Link to={`/schedules`}>{j.scheduleId}</Link> : '—'}
              </Descriptions.Item>
              {j.workflowStepKey && (
                <Descriptions.Item label="Step">{j.workflowStepKey}</Descriptions.Item>
              )}
            </Descriptions>
            {j.failureMessage && (
              <Card size="small" type="inner" title="Failure message" style={{ marginTop: 16 }}>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: 12,
                    color: '#ef4444',
                  }}
                >
                  {j.failureMessage}
                </pre>
              </Card>
            )}
            <Card size="small" type="inner" title="Data" style={{ marginTop: 16 }}>
              <pre
                style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}
              >
                {JSON.stringify(j.data, null, 2)}
              </pre>
            </Card>
            {j.returnValue !== undefined && j.returnValue !== null && (
              <Card size="small" type="inner" title="Return value" style={{ marginTop: 16 }}>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(j.returnValue, null, 2)}
                </pre>
              </Card>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card className={styles.card} title="Lifecycle">
            <LifecycleTimeline job={j} />
          </Card>
        </Col>
      </Row>

      {isWorkflow && (
        <Card className={styles.card} title="Workflow run">
          {workflow.loading && !workflow.data ? (
            <Skeleton active />
          ) : workflow.data ? (
            <WorkflowView workflow={workflow.data} />
          ) : (
            <Typography.Text type="secondary">No workflow steps found.</Typography.Text>
          )}
        </Card>
      )}

      <AddJobForm
        open={cloneOpen}
        queue={j.queue}
        onClose={() => setCloneOpen(false)}
        initial={{ data: j.data, priority: j.priority }}
      />
    </Space>
  );
}
