/** Mutation request/response wire DTOs for the dashboard action endpoint. */
import type { JobStatus, PauseMode, RetryMode } from '@portqueue/core';

/** Body of a mutation request. `kind` selects the action; other fields are per-action. */
export interface ActionRequestDto {
  kind:
    | 'pause'
    | 'resume'
    | 'retry'
    | 'remove'
    | 'cancel'
    | 'purge'
    | 'add'
    | 'removeSchedule'
    | 'pauseInstance'
    | 'resumeInstance';
  /** Target queue name — required for all queue/job actions; omitted for instance actions. */
  queue?: string;
  /** Target instance key — required for `pauseInstance` / `resumeInstance`. */
  instanceKey?: string;
  jobId?: string;
  jobIds?: string[];
  scheduleId?: string;
  mode?: PauseMode;
  from?: RetryMode;
  statuses?: JobStatus[];
  /** For `add`: the AddJobOptions payload (data + options + optional recurring timing). */
  add?: {
    data: unknown;
    priority?: number;
    idempotencyKey?: string;
    singletonKey?: string;
    metadata?: Record<string, unknown>;
    /** One-off delay (a Duration string, ms number, or ISO date string). */
    startAfter?: number | string;
    /** Recurring: fixed interval (a Duration string or ms number). */
    startEvery?: number | string;
    /** Recurring: cron expression, optionally with a timezone. */
    cron?: string | { pattern: string; tz?: string };
  };
}

export interface ActionResultDto {
  ok: boolean;
  jobId?: string;
  scheduleId?: string;
  affected?: number;
}
