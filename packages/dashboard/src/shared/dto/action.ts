/** Mutation request/response wire DTOs for the dashboard action endpoint. */
import type { JobStatus, PauseMode, RetryMode } from '@portqueue/core';

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
