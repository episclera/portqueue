/**
 * Every state the dashboard shows, as an antd `Tag` whose colour says what the state means — one
 * module, so "Paused" is the same colour on the queues table, a queue's header and an instance's.
 *
 * Job statuses have their own palette (`StatusTag`, from `@portqueue/theme`'s status colours); this
 * covers the rest. The colours follow one scale: green is healthy and doing its job, amber is
 * deliberately held back, red is refusing work outright, grey is inactive.
 */
import React from 'react';
import { Tag } from 'antd';
import { LIVENESS_CONFIG, SCHEDULE_STATES_CONFIG, pauseStateLabel } from '../constants/labels';

/** A queue's or instance's pause state: running, paused (processing), or paused (all). */
export function PauseStateTag({
  row,
}: {
  row: { processingPaused: boolean; acceptingPaused?: boolean };
}): React.ReactElement {
  const color = !row.processingPaused ? 'success' : row.acceptingPaused ? 'error' : 'warning';
  return <Tag color={color}>{pauseStateLabel(row)}</Tag>;
}

/** Whether an instance is still heartbeating. A stale one is inactive, not failing. */
export function LivenessTag({ alive }: { alive: boolean }): React.ReactElement {
  return (
    <Tag color={alive ? 'success' : 'default'}>
      {alive ? LIVENESS_CONFIG.alive.label : LIVENESS_CONFIG.stale.label}
    </Tag>
  );
}

/** Whether a schedule is armed. Disabled is a deliberate hold, so it reads amber, not grey. */
export function ScheduleStateTag({ enabled }: { enabled: boolean }): React.ReactElement {
  return (
    <Tag color={enabled ? 'success' : 'warning'}>
      {enabled ? SCHEDULE_STATES_CONFIG.enabled.label : SCHEDULE_STATES_CONFIG.disabled.label}
    </Tag>
  );
}

/** A yes/no state such as "stalled": amber when it is true, since a stall wants a look. */
export function FlagTag({ on }: { on: boolean }): React.ReactElement {
  return <Tag color={on ? 'warning' : 'default'}>{on ? 'Yes' : 'No'}</Tag>;
}
