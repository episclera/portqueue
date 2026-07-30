import type { DatabaseEngine } from '../options/enums';
import type { JobStatus } from '../jobs/job-state.enum';
import type {
  InsertedJobRow,
  InstanceMetrics,
  InstanceRow,
  JobRecord,
  NewJobRecord,
  NewScheduleRow,
  QueueRow,
  ScheduleRow,
} from '../jobs/job-record';
import type { DriverCapability, DriverCapabilitySet } from './driver-capabilities';
import type { DriverContext } from './driver-context';
import type { TransactionHandle } from '../tx/transaction-handle';
import type { QueueOptions } from '../options/queue-options';

export interface DriverProbe {
  serverVersion: string;
  verifiedCapabilities: DriverCapability[];
}

export interface Subscription {
  unsubscribe(): Promise<void>;
}

/**
 * One schema version's worth of DDL. `statements(context)` resolves the engine's own authored SQL
 * against the live storage layout; the driver's {@link Driver.applyMigration} runs those statements
 * **and** records the version in a single transaction, so a crash can never leave an
 * applied-but-unrecorded migration. Identified by `version` alone — there is no checksum.
 */
export interface MigrationStep {
  version: number;
  statements(context: DriverContext): string[];
}

/**
 * The paging window a list read accepts. Both fields are optional so the same driver method
 * serves core's "give me everything" reads and the dashboard's paged ones; omitting them means
 * no window at all rather than a defaulted page.
 */
export interface PageWindow {
  limit?: number;
  offset?: number;
}

/** Narrowing for {@link Driver.listQueues} / {@link Driver.countQueues}. */
export interface QueueListFilter {
  /** Case-insensitive substring of the queue name. */
  search?: string;
  /** Match only queues whose `processing_paused` equals this. */
  processingPaused?: boolean;
}

/** Narrowing for {@link Driver.listSchedules} / {@link Driver.countSchedules}. */
export interface ScheduleListFilter {
  queueName?: string;
  enabled?: boolean;
  /** Case-insensitive substring matched against the schedule id, queue name and cron pattern. */
  search?: string;
}

/** Narrowing for {@link Driver.listInstances} / {@link Driver.countInstances}. */
export interface InstanceListFilter {
  /** Case-insensitive substring of the instance key. */
  search?: string;
  processingPaused?: boolean;
  /**
   * Liveness cutoff: with `alive: true` only instances seen at or after `seenSince` match, with
   * `alive: false` only those seen before it. The caller derives the cutoff from its own clock and
   * heartbeat config, so the driver never needs to know the liveness window.
   */
  alive?: boolean;
  seenSince?: number;
}

/**
 * Narrowing for {@link Driver.getJobs} / {@link Driver.countJobs}. Every filter here is applied in
 * SQL — including `search`, so a text query pages in the database rather than scanning the table
 * into the process and filtering there.
 */
export interface JobListFilter {
  queueName?: string;
  statuses?: JobStatus[];
  scheduleId?: string;
  processedOnInstanceKey?: string;
  /**
   * Case-insensitive substring matched against the fields an operator triages by: the job id, its
   * status, its idempotency key, its failure message and its serialized payload.
   */
  search?: string;
}

/**
 * A job identified together with the queue it is on. Every mutating driver method that acts on a
 * job by id returns this rather than a bare boolean: the caller needs the queue name to emit its
 * event and to wake the right worker, and reading it back afterwards would be a second round trip
 * (or, on a single-connection engine, a deadlock).
 */
export interface JobRef {
  jobId: string;
  queueName: string;
}

/** A reclaimed job plus the instance key that was holding it when its lock lapsed. */
export interface StalledJobRef extends JobRef {
  previousInstanceKey: string | null;
}

/** A re-armed job: its ref plus the state the caller reports back to the developer. */
export interface RequeuedJobRef extends JobRef {
  status: JobStatus;
  startAfter: number;
}

/** A schedule identified together with its queue, for the same reason {@link JobRef} exists. */
export interface ScheduleRef {
  scheduleId: string;
  queueName: string;
}

/**
 * The database-agnostic seam. ALL SQL and engine-specific behavior
 * lives behind this contract. Core services branch on {@link DriverCapability}, never
 * on driver identity. Every method with >1 argument takes a named-options object.
 */
export interface Driver {
  readonly engine: DatabaseEngine;
  readonly capabilities: DriverCapabilitySet;
  /**
   * This driver's resolved storage context (table prefix, schema, pub/sub namespace). The driver
   * builds it from its own constructor options — storage layout is per-engine, not global — and
   * core reads it here. See {@link DriverContext}.
   */
  readonly context: DriverContext;
  /**
   * The ordered migration steps this driver ships, authored alongside the driver (see
   * `drivers/<engine>/migrations.ts`). The shared migration runner applies the pending ones; each
   * step's DDL is the engine's own — nothing is shared or generated across engines.
   */
  readonly migrations: MigrationStep[];

  // Identity & lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  probe(): Promise<DriverProbe>;

  // Schema & migration
  /**
   * The highest applied schema version, or `null` when the migration table does not exist yet.
   * An implementation must distinguish "table absent" from every other failure: a dropped
   * connection or a permissions error has to surface, not read as "never migrated" and trigger a
   * full migration run.
   */
  getSchemaVersion(): Promise<number | null>;
  /** Apply one step's DDL and record its version, both in a single transaction. */
  applyMigration(options: { migration: MigrationStep }): Promise<void>;

  // Producing
  insertJob(options: { job: NewJobRecord; tx?: TransactionHandle }): Promise<InsertedJobRow>;
  /**
   * Insert many jobs. A real batch: one multi-row `INSERT` (and, when dedup keys are set, one
   * grouped pre-insert lookup) rather than a loop over {@link insertJob}. Results come back in the
   * order the jobs were given.
   */
  insertJobs(options: { jobs: NewJobRecord[]; tx?: TransactionHandle }): Promise<InsertedJobRow[]>;
  /**
   * Insert a recurring schedule. Identical recurrences are allowed to coexist — dedup (when
   * wanted) is the caller's job via {@link findScheduleByIdempotencyKey} + a stored idempotency key.
   */
  insertSchedule(options: {
    schedule: NewScheduleRow;
    tx?: TransactionHandle;
  }): Promise<ScheduleRow>;
  /** Find an existing job on this queue carrying this idempotency key (dedup lookup). */
  findJobByIdempotencyKey(options: {
    queueName: string;
    idempotencyKey: string;
    tx?: TransactionHandle;
  }): Promise<InsertedJobRow | null>;
  /** Find an existing schedule on this queue carrying this idempotency key (dedup lookup). */
  findScheduleByIdempotencyKey(options: {
    queueName: string;
    idempotencyKey: string;
    tx?: TransactionHandle;
  }): Promise<ScheduleRow | null>;
  /** Delete one schedule, returning its ref when a row went away and `null` when none matched. */
  deleteSchedule(options: {
    scheduleId: string;
    tx?: TransactionHandle;
  }): Promise<ScheduleRef | null>;
  /** Delete many schedules in one statement, returning a ref per row actually removed. */
  deleteSchedules(options: {
    scheduleIds: string[];
    tx?: TransactionHandle;
  }): Promise<ScheduleRef[]>;
  /** Arm or disarm a schedule without deleting it (the dashboard's enable/disable action). */
  setScheduleEnabled(options: {
    scheduleId: string;
    enabled: boolean;
    now: number;
    tx?: TransactionHandle;
  }): Promise<ScheduleRef | null>;

  // Claiming & completing (hot path)
  /**
   * Atomically claim up to `limit` due jobs and return them.
   *
   * The claim must be exclusive: a row this call returns is `ACTIVE` with a `locked_until` in the
   * future, and no concurrent claimer — in this process or another — may return the same row until
   * that lock lapses. Implementations either take `FOR UPDATE SKIP LOCKED` over the candidate set
   * or guard the `UPDATE` on the pre-claim status, never both-optional.
   *
   * `processingPaused` on the queue row is honoured here rather than by the caller, so the hot path
   * costs one query instead of a pause read plus a claim.
   */
  claimJobs(options: {
    queueName: string;
    limit: number;
    /** Visibility window for the claimed rows, in seconds. */
    lockDurationSeconds: number;
    now: number;
    /** This instance's multi-instance key, or null when the process is unnamed. */
    instanceKey?: string | null;
  }): Promise<JobRecord[]>;
  /** Push a claimed job's lock out by `lockDurationSeconds` seconds; a negative value releases it. */
  extendLock(options: {
    jobId: string;
    lockDurationSeconds: number;
    now: number;
  }): Promise<boolean>;
  completeJob(options: {
    jobId: string;
    returnValue?: unknown;
    now: number;
    tx?: TransactionHandle;
  }): Promise<void>;
  retryJob(options: {
    jobId: string;
    nextRunAt: number;
    retryAttempt: number;
    lastError: string;
    now: number;
  }): Promise<void>;
  failJob(options: { jobId: string; lastError: string; now: number }): Promise<void>;
  /**
   * Return up to `limit` `ACTIVE` jobs whose lock has lapsed to `PENDING`. Bounded and looped by
   * the caller: an unbounded sweep over a large backlog would transfer every column of every row
   * and emit an event per row inside one transaction.
   */
  reclaimStalledJobs(options: {
    queueName?: string;
    limit: number;
    now: number;
  }): Promise<StalledJobRef[]>;
  /** Expire up to `limit` due-but-unstarted jobs past their deadline. Bounded like the reclaim. */
  expireDueJobs(options: { queueName?: string; limit: number; now: number }): Promise<JobRef[]>;
  /**
   * Re-arm a job's own row so it runs again (manual retry).
   *
   * Refuses an `ACTIVE` row and returns `null`: re-arming a job whose handler is still running
   * clears its lock and lets a second worker claim it, so the same job would run twice
   * concurrently. Also returns `null` when the id matches nothing — a stale id is not an error.
   */
  requeueJob(options: {
    jobId: string;
    now: number;
    tx?: TransactionHandle;
  }): Promise<RequeuedJobRef | null>;
  /** Re-arm many jobs in one statement, with the same `ACTIVE` refusal, returning what was re-armed. */
  requeueJobs(options: {
    jobIds: string[];
    now: number;
    tx?: TransactionHandle;
  }): Promise<RequeuedJobRef[]>;

  // Reading
  /**
   * One job row by id. Takes `tx` because a mutating driver method may need to read the row it is
   * about to change: on a single-connection engine (SQLite, PGLite) a read issued outside the
   * in-flight transaction queues *behind* it and deadlocks the connection for good.
   */
  getJob(options: { jobId: string; tx?: TransactionHandle }): Promise<JobRecord | null>;
  /** A page of job rows, always newest-first by `created_at`. There is no caller-chosen order. */
  getJobs(options: JobListFilter & { limit: number; offset: number }): Promise<JobRecord[]>;
  countJobsByStatus(options: {
    queueName?: string;
    processedOnInstanceKey?: string;
  }): Promise<Record<JobStatus, number>>;
  /**
   * Per-status counts for many queues in **one** grouped query, keyed by queue name. Replaces a
   * `countJobsByStatus` call per row when a list page needs a count breakdown for each of its
   * queues; a name absent from the result simply has no jobs.
   */
  countJobsByStatusPerQueue(options: {
    queueNames: string[];
  }): Promise<Record<string, Record<JobStatus, number>>>;
  /** The {@link countJobsByStatusPerQueue} equivalent keyed by `processed_on_instance_key`. */
  countJobsByStatusPerInstance(options: {
    instanceKeys: string[];
  }): Promise<Record<string, Record<JobStatus, number>>>;
  /** Total rows matching a {@link Driver.getJobs} filter, ignoring paging. */
  countJobs(options: JobListFilter): Promise<number>;
  /**
   * Queue rows, optionally narrowed and paged. Called with no options it returns every queue —
   * the shape core's own reads rely on. `search` is a case-insensitive substring of the name.
   */
  listQueues(options?: QueueListFilter & PageWindow): Promise<QueueRow[]>;
  /** Total queues matching a {@link listQueues} filter, ignoring paging. */
  countQueues(options?: QueueListFilter): Promise<number>;
  listSchedules(options: ScheduleListFilter & PageWindow): Promise<ScheduleRow[]>;
  /** Total schedules matching a {@link listSchedules} filter, ignoring paging. */
  countSchedules(options: ScheduleListFilter): Promise<number>;
  getSchedule(options: { scheduleId: string }): Promise<ScheduleRow | null>;
  getDueSchedules(options: { now: number; limit: number }): Promise<ScheduleRow[]>;
  /**
   * Advance a schedule's next-run, guarded on its previous value so only one instance
   * claims each tick. Returns true if this caller won the claim.
   */
  advanceSchedule(options: {
    scheduleId: string;
    nextRunAt: number | null;
    lastRunAt: number;
    fromNextRunAt: number;
  }): Promise<boolean>;

  // Job control
  /** Cancel a pending/delayed job. Returns its ref, or `null` when nothing was cancellable. */
  cancelJob(options: {
    jobId: string;
    now: number;
    tx?: TransactionHandle;
  }): Promise<JobRef | null>;
  /** Cancel many jobs in one statement, returning a ref per row actually cancelled. */
  cancelJobs(options: { jobIds: string[]; now: number; tx?: TransactionHandle }): Promise<JobRef[]>;
  /**
   * Remove a job's row. Never removes an `ACTIVE` one — that row belongs to a running handler — so
   * an active or missing id returns `null`.
   */
  removeJob(options: { jobId: string; tx?: TransactionHandle }): Promise<JobRef | null>;
  /** Remove many jobs in one statement, skipping `ACTIVE` rows, returning what went away. */
  removeJobs(options: { jobIds: string[]; tx?: TransactionHandle }): Promise<JobRef[]>;
  removeJobsByStatus(options: {
    queueName: string;
    statuses: JobStatus[];
    tx?: TransactionHandle;
  }): Promise<number>;

  // Queue control
  setQueuePaused(options: {
    queueName: string;
    processingPaused?: boolean;
    acceptingPaused?: boolean;
    now: number;
    tx?: TransactionHandle;
  }): Promise<QueueRow | null>;
  ensureQueue(options: {
    name: string;
    options?: QueueOptions;
    now: number;
    tx?: TransactionHandle;
  }): Promise<QueueRow>;
  /** One queue row by name. Takes `tx` for the same reason {@link Driver.getJob} does. */
  getQueueByName(options: { name: string; tx?: TransactionHandle }): Promise<QueueRow | null>;
  /** Delete a queue row by name (manual admin removal; the tool never calls this on its own). */
  deleteQueue(options: { name: string; tx?: TransactionHandle }): Promise<boolean>;

  // Instance liveness & per-instance pause
  /**
   * Record a heartbeat: bump `last_seen_at` and, when the caller has a sample, this instance's
   * health. Metrics are COALESCEd, so a beat without one keeps the previous reading rather than
   * blanking it. Must never touch the independently-controlled pause flag, and must return the
   * resulting row — the caller reads its `processingPaused` from here rather than re-reading it.
   */
  upsertInstance(options: {
    instanceKey: string;
    now: number;
    metrics?: InstanceMetrics;
  }): Promise<InstanceRow>;
  /** Instance rows, optionally narrowed and paged. No options returns every instance. */
  listInstances(options?: InstanceListFilter & PageWindow): Promise<InstanceRow[]>;
  /** Total instances matching a {@link listInstances} filter, ignoring paging. */
  countInstances(options?: InstanceListFilter): Promise<number>;
  getInstance(options: { instanceKey: string }): Promise<InstanceRow | null>;
  setInstancePaused(options: {
    instanceKey: string;
    processingPaused: boolean;
    now: number;
  }): Promise<void>;
  /** Delete an instance row by key (manual admin removal of a long-inactive instance). */
  deleteInstance(options: { instanceKey: string; tx?: TransactionHandle }): Promise<boolean>;

  // Retention
  /**
   * Delete up to `limit` finished job rows whose retention window has elapsed.
   *
   * Which statuses a row is eligible in is the **row's own** setting: `retention_statuses` holds
   * the encoded list the caller asked for, or NULL for "every finished status". The sweeper
   * therefore passes no status list — a policy lives on the job it was resolved for.
   */
  deleteFinishedJobs(options: { olderThan: number; limit: number }): Promise<number>;

  // Pub/sub (only meaningful with LISTEN_NOTIFY)
  notify(options: { channel: string; payload: string }): Promise<void>;
  subscribe(options: {
    channel: string;
    onNotification: (payload: string) => void;
  }): Promise<Subscription>;

  // Transactions (internal use only)
  runInTransaction<T>(options: { fn: (tx: TransactionHandle) => Promise<T> }): Promise<T>;

  // Advisory lock for leader-only tasks (optional)
  tryAdvisoryLock?(options: { key: string }): Promise<boolean>;
  releaseAdvisoryLock?(options: { key: string }): Promise<void>;
}
