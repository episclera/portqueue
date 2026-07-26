/** Mutation request/response wire DTOs for the dashboard action endpoint. */
import type { PauseMode } from '@portqueue/core';

/** Every mutation the dashboard can ask for. An enum, so no route matches a magic string. */
export enum ActionKind {
  PAUSE = 'pause',
  RESUME = 'resume',
  RETRY = 'retry',
  REMOVE = 'remove',
  CANCEL = 'cancel',
  ADD = 'add',
  REMOVE_SCHEDULE = 'removeSchedule',
  SET_SCHEDULE_ENABLED = 'setScheduleEnabled',
  REMOVE_QUEUE = 'removeQueue',
  PAUSE_INSTANCE = 'pauseInstance',
  RESUME_INSTANCE = 'resumeInstance',
  REMOVE_INSTANCE = 'removeInstance',
}

/** The payload an `add` action carries — the subset of core `AddJobOptions` the form exposes. */
export interface AddJobRequestDto {
  data: unknown;
  priority?: number;
  idempotencyKey?: string;
  singletonKey?: string;
  /** Cap on automatic retries for this job. */
  retryMaxAttempts?: number;
  /** Regex matching the instance keys this job may run on. */
  preferredInstanceKeyPattern?: string;
  /** One-off: run at this absolute instant (an ISO date string). */
  startAfter?: string;
  /** One-off: delay this many **seconds** from now. */
  startAfterSeconds?: number;
  /** Recurring: fixed interval, in **seconds**. */
  startEverySeconds?: number;
  /** Recurring: cron expression, optionally with a timezone. */
  cron?: string | { pattern: string; tz?: string };
}

/** Body of a mutation request. `kind` selects the action; other fields are per-action. */
export interface ActionRequestDto {
  kind: ActionKind;
  /** Target queue name — required for all queue/job actions; omitted for instance actions. */
  queue?: string;
  /** Target instance key — required for `pauseInstance` / `resumeInstance` / `removeInstance`. */
  instanceKey?: string;
  jobId?: string;
  /**
   * Many job ids for a bulk retry / cancel / remove. The server applies them in **one
   * transaction**, so the batch either lands whole or not at all.
   */
  jobIds?: string[];
  scheduleId?: string;
  /** Many schedule ids for a bulk removal, in one transaction. */
  scheduleIds?: string[];
  /** For `setScheduleEnabled`: whether the schedule should be armed. */
  enabled?: boolean;
  mode?: PauseMode;
  add?: AddJobRequestDto;
}

export interface ActionResultDto {
  ok: boolean;
  jobId?: string;
  scheduleId?: string;
  /** Rows the action actually changed. */
  affected?: number;
  /** Ids submitted, when the action was a batch — so the UI can say "3 of 5". */
  requested?: number;
}
