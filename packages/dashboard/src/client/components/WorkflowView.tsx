/**
 * Workflow run view (build_plan/12.4): a step-by-step timeline built from the run's job rows
 * (getWorkflow), in created_at order. One segment per step job with its workflow_step_key,
 * an outcome badge, started→ended with duration, expandable data/return_value JSON, and the
 * failure message on failure. Repeats/retries show as repeated rows; a header shows progress.
 */
import React from 'react';
import { Collapse, Space, Timeline, Typography } from 'antd';
import { JobStatus } from '../queries/enums.js';
import { StatusTag, tokens } from '@portqueue/ui';
import type { JobDto, WorkflowDto } from '../../shared/dto.js';
import { duration, formatDate } from './format.js';

function stepEnd(step: JobDto): string | null | undefined {
  return step.completedAt ?? step.failedAt ?? step.cancelledAt ?? step.expiredAt;
}

function stepColor(step: JobDto): string {
  return tokens.color.status[step.status] ?? tokens.color.status.PENDING;
}

function Json({ label, value }: { label: string; value: unknown }): React.ReactElement | null {
  if (value === undefined || value === null) return null;
  return (
    <Collapse
      ghost
      size="small"
      items={[
        {
          key: label,
          label,
          children: (
            <pre
              style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {JSON.stringify(value, null, 2)}
            </pre>
          ),
        },
      ]}
    />
  );
}

export function WorkflowView({ workflow }: { workflow: WorkflowDto }): React.ReactElement {
  const steps = workflow.steps;
  const completed = steps.filter((s) => s.status === JobStatus.COMPLETED).length;
  const distinctKeys = new Set(steps.map((s) => s.workflowStepKey ?? s.id));

  const items = steps.map((step) => ({
    color: stepColor(step),
    children: (
      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        <Space wrap>
          <Typography.Text strong>{step.workflowStepKey ?? '(step)'}</Typography.Text>
          <StatusTag status={step.status} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {duration(step.startedAt, stepEnd(step))}
          </Typography.Text>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatDate(step.startedAt)} → {formatDate(stepEnd(step))}
        </Typography.Text>
        {step.failureMessage && (
          <Typography.Text type="danger" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {step.failureMessage}
          </Typography.Text>
        )}
        <Json label="Input (data)" value={step.data} />
        <Json label="Output (return value)" value={step.returnValue} />
      </Space>
    ),
  }));

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {completed} / {distinctKeys.size} distinct steps completed · {steps.length} total job rows
        (repeats &amp; retries shown)
      </Typography.Paragraph>
      <Timeline items={items} />
    </div>
  );
}
