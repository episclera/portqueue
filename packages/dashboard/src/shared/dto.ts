/**
 * Wire DTO types shared by the server API and the client SPA (build_plan/12.2).
 * Single source of truth for the JSON crossing the boundary. Dates are serialized
 * as ISO strings so they survive JSON; the client reformats them.
 */
import type { JobStatus, PauseMode, RetryMode } from '@portqueue/core';

/** JobStatus → count map, wire form. */
export type CountsDto = Record<string, number>;

/** A read-side job, serialized for the wire (mirrors core `JobSnapshot`). */
export interface JobDto {
  id: string;
  queue: string;
  status: JobStatus;
  data: unknown;
  returnValue?: unknown;
  metadata: Record<string, unknown>;
  priority: number;
  retryAttempt: number;
  retryMaxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startAfter: string;
  startedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  cancelledAt?: string | null;
  expiredAt?: string | null;
  retriedAt?: string | null;
  stalledAt?: string | null;
  lockedUntil?: string | null;
  runOnInstanceId?: string | null;
  runOnInstanceType?: string | null;
  failureMessage?: string | null;
  idempotencyKey?: string | null;
  scheduleId?: string | null;
  workflowId?: string | null;
  workflowStepKey?: string | null;
  stalled: boolean;
}

/** Queue overview (mirrors core `QueueInfo`). */
export interface QueueDto {
  name: string;
  processingPaused: boolean;
  acceptingPaused: boolean;
  counts: CountsDto;
}

/** Aggregated stats (mirrors core `QueueStats`). */
export interface StatsDto {
  queue?: string;
  counts: CountsDto;
  throughputPerMinute: number;
  failureRate: number;
}

/** Cursor page of jobs. */
export interface JobPageDto {
  items: JobDto[];
  cursor: string | null;
  hasMore: boolean;
}

/** A whole workflow run (mirrors core `WorkflowSnapshot`). */
export interface WorkflowDto {
  workflowId: string;
  queue: string;
  steps: JobDto[];
}

/** A recurring schedule (mirrors core `ScheduleInfo`), plus its queue. */
export interface ScheduleDto {
  scheduleId: string;
  queue: string;
  key: string;
  cron?: string | null;
  every?: number | null;
  timezone?: string | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  enabled: boolean;
  startAt?: string | null;
  endAt?: string | null;
}

/** Per-instance job attribution row for the Overview page. */
export interface InstanceBreakdownDto {
  instanceId: string;
  instanceType: string;
  count: number;
}

/** Static config the server injects into the SPA shell. */
export interface DashboardConfigDto {
  basePath: string;
  title: string;
  theme: 'light' | 'dark' | 'system';
  readOnly: boolean;
}

/** Body of a mutation request. `kind` selects the action; other fields are per-action. */
export interface ActionRequestDto {
  kind: 'pause' | 'resume' | 'retry' | 'remove' | 'cancel' | 'purge' | 'add' | 'removeSchedule';
  queue: string;
  jobId?: string;
  jobIds?: string[];
  scheduleId?: string;
  mode?: PauseMode;
  from?: RetryMode;
  statuses?: JobStatus[];
  /** For `add`: the AddJobOptions payload (data + options + optional schedule). */
  add?: {
    data: unknown;
    priority?: number;
    idempotencyKey?: string;
    singletonKey?: string;
    metadata?: Record<string, unknown>;
    schedule?: {
      key: string;
      cron?: string;
      every?: number;
      timezone?: string;
    };
  };
}

export interface ActionResultDto {
  ok: boolean;
  jobId?: string;
  scheduleId?: string;
  affected?: number;
}
