/**
 * Workflow run view: a step-by-step timeline built from the run's job rows
 * (getWorkflow), in created_at order. One segment per step job with its workflow_step_key,
 * an outcome badge, started→ended with duration, expandable data/return_value JSON, and the
 * failure message on failure. Repeats/retries show as repeated rows; a header shows progress.
 */
import React from 'react';
import { Collapse, Inline, Paragraph, Stack, StatusTag, Text, Timeline, tokens } from '@portqueue/ui';
import type { TimelineItem } from '@portqueue/ui';
import { JobStatus } from '../queries/enums.js';
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
      items={[
        {
          key: label,
          header: label,
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

  const items: TimelineItem[] = steps.map((step, i) => ({
    key: `${step.id}-${i}`,
    color: stepColor(step),
    children: (
      <Stack gap={1} style={{ width: '100%' }}>
        <Inline gap={2} wrap align="center">
          <Text $strong>{step.workflowStepKey ?? '(step)'}</Text>
          <StatusTag status={step.status} />
          <Text $tone="muted" $small>
            {duration(step.startedAt, stepEnd(step))}
          </Text>
        </Inline>
        <Text $tone="muted" $small>
          {formatDate(step.startedAt)} → {formatDate(stepEnd(step))}
        </Text>
        {step.failureMessage && (
          <Text $tone="danger" $small style={{ whiteSpace: 'pre-wrap' }}>
            {step.failureMessage}
          </Text>
        )}
        <Json label="Input (data)" value={step.data} />
        <Json label="Output (return value)" value={step.returnValue} />
      </Stack>
    ),
  }));

  return (
    <div>
      <Paragraph $tone="muted" style={{ marginBottom: 12 }}>
        {completed} / {distinctKeys.size} distinct steps completed · {steps.length} total job rows
        (repeats &amp; retries shown)
      </Paragraph>
      <Timeline items={items} />
    </div>
  );
}
