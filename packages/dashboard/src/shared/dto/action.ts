/** Mutation request/response wire DTOs for the dashboard action endpoints. */
import type { PauseMode } from '@portqueue/core';

/**
 * Every mutation the dashboard can ask for. An enum, so no route matches a magic string — and the
 * value **is** the URL segment the mutation posts to (`POST {basePath}/api/actions/<kind>`), so an
 * action has exactly one endpoint and there is no second spelling to keep in sync.
 */
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
  /** One-off: delay this many **seconds** from now. */
  startAfterSeconds?: number;
  /** Recurring: fixed interval, in **seconds**. */
  startEverySeconds?: number;
  /** Recurring: cron expression, optionally with a timezone. */
  cron?: string | { pattern: string; tz?: string };
}

/**
 * The body of a mutation — the per-action fields, and nothing that selects the action.
 *
 * Which mutation runs is decided by the URL alone (`/api/actions/<kind>`). The body carried a `kind`
 * field once, back when every mutation posted to one endpoint; keeping both would be two doors to
 * one room, and a body whose `kind` disagreed with its path would have to mean something.
 */
export interface ActionPayloadDto {
  /** Target queue name — required for all queue/job actions; omitted for instance actions. */
  queue?: string;
  /** Target instance key — required for `pauseInstance` / `resumeInstance` / `removeInstance`. */
  instanceKey?: string;
  jobId?: string;
  /**
   * Many job ids for a bulk retry / cancel / remove. The server applies them in **one transaction**,
   * so the batch either lands whole or not at all. Capped at {@link MAX_BATCH_IDS} ids per request.
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

/**
 * A mutation, as the client's `api.action` takes it: the payload plus the `kind` that names the
 * endpoint. `kind` is stripped into the URL before the request goes out and never reaches the wire.
 */
export interface ActionRequestDto extends ActionPayloadDto {
  kind: ActionKind;
}

export interface ActionResultDto {
  ok: boolean;
  jobId?: string;
  scheduleId?: string;
  /** Rows the action actually changed. */
  affected?: number;
  /** Ids submitted, when the action was a batch — so the UI can say "3 of 5". */
  requested?: number;
  /**
   * Jobs a cancel could only *ask* to stop, because they are running in the dashboard's own process.
   * Reported apart from `affected`: nothing has been cancelled yet, and a handler that ignores
   * `job.signal` finishes normally.
   */
  signalled?: number;
}
