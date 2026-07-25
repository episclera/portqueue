/**
 * Display config for every enum / boolean state the dashboard renders. The UI never prints a
 * raw enum value: it looks the label up here, so casing and wording stay consistent (Pascal
 * case, never SCREAMING_CASE) and there is a single place to change them.
 */
import { JobStatus, PauseMode } from '../queries/enums';

export interface DisplayConfig {
  label: string;
  /** Optional emoji, used where an icon reads better than text. */
  icon?: string;
}

/** The synthetic status a job takes on when its lock has lapsed (not a core JobStatus). */
export const STALLED = 'STALLED';

/** JobStatus → label. */
export const STATUSES_CONFIG: Record<JobStatus, DisplayConfig> = {
  [JobStatus.PENDING]: { label: 'Pending' },
  [JobStatus.ACTIVE]: { label: 'Active' },
  [JobStatus.COMPLETED]: { label: 'Completed' },
  [JobStatus.FAILED]: { label: 'Failed' },
  [JobStatus.RETRY]: { label: 'Retry' },
  [JobStatus.CANCELLED]: { label: 'Cancelled' },
  [JobStatus.EXPIRED]: { label: 'Expired' },
};

/** The stalled pseudo-status' label, kept beside the real ones. */
export const STALLED_LABEL = 'Stalled';

/**
 * The statuses every count breakdown shows as table columns — the queues table and the instances
 * table. Pending sits next to Active so a row reads as "running now / waiting next"; Retry is
 * absent, like on the activity cards, since a retrying job is still in flight.
 */
export const COUNT_STATUSES: JobStatus[] = [
  JobStatus.ACTIVE,
  JobStatus.PENDING,
  JobStatus.FAILED,
  JobStatus.COMPLETED,
];

/**
 * The statuses the activity cards show, leading with what is running right now, then what is
 * waiting and how work ended. Retry is deliberately absent — a retrying job is still in flight
 * and is covered by the row-level attempt column.
 */
export const CARD_STATUSES: JobStatus[] = [
  JobStatus.ACTIVE,
  JobStatus.PENDING,
  JobStatus.FAILED,
  JobStatus.COMPLETED,
];

/** Label for any status-ish string, including `STALLED`. Falls back to the raw value. */
export function statusLabel(status: string): string {
  if (status === STALLED) return STALLED_LABEL;
  return STATUSES_CONFIG[status as JobStatus]?.label ?? status;
}

/** PauseMode → label, as offered in the pause menu. */
export const PAUSE_MODES_CONFIG: Record<PauseMode, DisplayConfig> = {
  [PauseMode.PROCESSING]: { label: 'Pause processing (still accepts jobs)' },
  [PauseMode.ALL]: { label: 'Pause all (also refuse new jobs)' },
};

/** Whether a queue is declared by a running process. */
export const QUEUE_USAGE_CONFIG = {
  inUse: { label: 'In use' },
  unused: { label: 'Unused' },
} satisfies Record<string, DisplayConfig>;

/** A queue's / instance's pause state. */
export const PAUSE_STATES_CONFIG = {
  running: { label: 'Running' },
  processingPaused: { label: 'Paused' },
  allPaused: { label: 'Paused (all)' },
} satisfies Record<string, DisplayConfig>;

/** Instance liveness, derived from the last heartbeat. */
export const LIVENESS_CONFIG = {
  alive: { label: 'Alive' },
  stale: { label: 'Stale' },
} satisfies Record<string, DisplayConfig>;

/** Whether a schedule is armed. */
export const SCHEDULE_STATES_CONFIG = {
  enabled: { label: 'Enabled' },
  disabled: { label: 'Disabled' },
} satisfies Record<string, DisplayConfig>;

export interface ToggleConfig extends DisplayConfig {
  /** Tooltip copy explaining what pressing the control does. */
  hint: string;
}

/** The live-updates control: what the button does next, plus the hint for its tooltip. */
export const LIVE_TOGGLE_CONFIG = {
  live: {
    label: 'Pause',
    icon: '⏸️',
    hint: 'Auto-updates are on (every 30s) — pause to freeze the data',
  },
  paused: {
    label: 'Resume',
    icon: '▶️',
    hint: 'Auto-updates are paused — data is frozen until you resume',
  },
} satisfies Record<string, ToggleConfig>;

/** Row / bulk action icons, so every table spells an action the same way. */
export const ACTIONS_CONFIG = {
  retry: { label: 'Retry', icon: '🔄' },
  cancel: { label: 'Cancel', icon: '🚫' },
  remove: { label: 'Remove', icon: '🗑️' },
  pause: { label: 'Pause', icon: '⏸️' },
  resume: { label: 'Resume', icon: '▶️' },
  open: { label: 'Open', icon: '↗️' },
  add: { label: 'Add job', icon: '➕' },
  filters: { label: 'Filters', icon: '⚙️' },
  search: { label: 'Search', icon: '🔍' },
  refresh: { label: 'Refresh', icon: '🔄' },
  copy: { label: 'Copy', icon: '📋' },
  clone: { label: 'Clone', icon: '📄' },
  bulk: { label: 'Bulk actions', icon: '☰' },
} satisfies Record<string, DisplayConfig>;

/** Pause state of a queue-like row, as a single labelled state. */
export function pauseStateLabel(row: {
  processingPaused: boolean;
  acceptingPaused?: boolean;
}): string {
  if (!row.processingPaused) return PAUSE_STATES_CONFIG.running.label;
  return row.acceptingPaused
    ? PAUSE_STATES_CONFIG.allPaused.label
    : PAUSE_STATES_CONFIG.processingPaused.label;
}

/** Shared "State" filter options for the queue + instance tables (both filter on pausing). */
export const PAUSE_STATE_FILTER_OPTIONS = [
  { label: PAUSE_STATES_CONFIG.running.label, value: 'running' },
  { label: PAUSE_STATES_CONFIG.processingPaused.label, value: 'paused' },
];
