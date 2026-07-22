import type { JobStatus } from '../jobs/job-state.enum.js';

/**
 * All observable lifecycle events (build_plan/08.1). Emitted on the PortQueue instance.
 * Every listener receives one typed payload object.
 */
export enum PortQueueEvent {
  CLIENT_STARTED = 'CLIENT_STARTED',
  CLIENT_STOPPING = 'CLIENT_STOPPING',
  CLIENT_STOPPED = 'CLIENT_STOPPED',
  MIGRATION_APPLIED = 'MIGRATION_APPLIED',
  ERROR = 'ERROR',

  JOB_ADDED = 'JOB_ADDED',
  JOB_ACTIVE = 'JOB_ACTIVE',
  JOB_COMPLETED = 'JOB_COMPLETED',
  JOB_FAILED = 'JOB_FAILED',
  JOB_RETRYING = 'JOB_RETRYING',
  JOB_STALLED = 'JOB_STALLED',
  JOB_EXPIRED = 'JOB_EXPIRED',
  JOB_CANCELLED = 'JOB_CANCELLED',
  JOB_REMOVED = 'JOB_REMOVED',
  JOB_STEP_COMPLETED = 'JOB_STEP_COMPLETED',
  WORKFLOW_COMPLETED = 'WORKFLOW_COMPLETED',
  WORKFLOW_FAILED = 'WORKFLOW_FAILED',

  SCHEDULE_CREATED = 'SCHEDULE_CREATED',
  SCHEDULE_UPDATED = 'SCHEDULE_UPDATED',
  SCHEDULE_REMOVED = 'SCHEDULE_REMOVED',
  SCHEDULE_FIRED = 'SCHEDULE_FIRED',

  QUEUE_PAUSED = 'QUEUE_PAUSED',
  QUEUE_RESUMED = 'QUEUE_RESUMED',
  WORKER_STARTED = 'WORKER_STARTED',
  WORKER_STOPPED = 'WORKER_STOPPED',
  SYSTEM_PRESSURE_HIGH = 'SYSTEM_PRESSURE_HIGH',
  SYSTEM_PRESSURE_NORMAL = 'SYSTEM_PRESSURE_NORMAL',
}

/** Source of an internal error surfaced via {@link PortQueueEvent.ERROR}. */
export type ErrorSource =
  | 'claim'
  | 'execution'
  | 'scheduler'
  | 'retention'
  | 'subscriber'
  | 'notifier'
  | 'listener'
  | 'hook'
  | 'monitor'
  | 'migration';

/** The typed payload for every event (build_plan/08.1). */
export interface PortQueueEventPayloads {
  [PortQueueEvent.CLIENT_STARTED]: { instanceId: string };
  [PortQueueEvent.CLIENT_STOPPING]: { instanceId: string };
  [PortQueueEvent.CLIENT_STOPPED]: { instanceId: string };
  [PortQueueEvent.MIGRATION_APPLIED]: { from: number | null; to: number };
  [PortQueueEvent.ERROR]: { error: unknown; source: ErrorSource };

  [PortQueueEvent.JOB_ADDED]: { jobId: string; queue: string; deduplicated: boolean };
  [PortQueueEvent.JOB_ACTIVE]: {
    jobId: string;
    queue: string;
    retryAttempt: number;
    instanceId: string;
  };
  [PortQueueEvent.JOB_COMPLETED]: {
    jobId: string;
    queue: string;
    returnValue: unknown;
    durationMs: number;
  };
  [PortQueueEvent.JOB_FAILED]: {
    jobId: string;
    queue: string;
    error: unknown;
    retryAttempt: number;
  };
  [PortQueueEvent.JOB_RETRYING]: {
    jobId: string;
    queue: string;
    retryAttempt: number;
    nextRunAt: Date;
  };
  [PortQueueEvent.JOB_STALLED]: { jobId: string; queue: string; previousInstanceId: string | null };
  [PortQueueEvent.JOB_EXPIRED]: { jobId: string; queue: string };
  [PortQueueEvent.JOB_CANCELLED]: { jobId: string; queue: string };
  [PortQueueEvent.JOB_REMOVED]: { jobId: string; queue: string };
  [PortQueueEvent.JOB_STEP_COMPLETED]: {
    jobId: string;
    queue: string;
    workflowId: string;
    stepKey: string;
    nextStepKey?: string;
    nextJobId?: string;
  };
  [PortQueueEvent.WORKFLOW_COMPLETED]: {
    workflowId: string;
    queue: string;
    result: unknown;
    lastStepKey: string;
    jobId: string;
  };
  [PortQueueEvent.WORKFLOW_FAILED]: {
    workflowId: string;
    queue: string;
    stepKey: string;
    jobId: string;
    error: unknown;
  };

  [PortQueueEvent.SCHEDULE_CREATED]: { scheduleId: string; queue: string };
  [PortQueueEvent.SCHEDULE_UPDATED]: { scheduleId: string; queue: string };
  [PortQueueEvent.SCHEDULE_REMOVED]: { scheduleId: string; queue: string };
  [PortQueueEvent.SCHEDULE_FIRED]: { scheduleId: string; jobId: string; queue: string };

  [PortQueueEvent.QUEUE_PAUSED]: { queue: string; mode: string };
  [PortQueueEvent.QUEUE_RESUMED]: { queue: string };
  [PortQueueEvent.WORKER_STARTED]: { queue: string };
  [PortQueueEvent.WORKER_STOPPED]: { queue: string };
  [PortQueueEvent.SYSTEM_PRESSURE_HIGH]: { metric: string; value: number; threshold: number };
  [PortQueueEvent.SYSTEM_PRESSURE_NORMAL]: Record<string, never>;
}

/** Job status re-export helper used in event/payload typing contexts. */
export type { JobStatus };

export type EventListener<E extends PortQueueEvent> = (payload: PortQueueEventPayloads[E]) => void;
export type Unsubscribe = () => void;
