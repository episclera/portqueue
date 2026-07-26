import type { DatabaseEngine } from '../options/enums';
import type { JobStatus } from '../jobs/job-state.enum';
import type {
  InsertedJobRow,
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

export interface MigrationStep {
  version: number;
  checksum: string;
  /** Run the migration against the driver in a transaction. */
  up(driver: Driver, context: DriverContext): Promise<void>;
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
  getSchemaVersion(): Promise<number | null>;
  applyMigration(options: { migration: MigrationStep }): Promise<void>;
  ensureBaseObjects(): Promise<void>;

  // Producing
  insertJob(options: { job: NewJobRecord; tx?: TransactionHandle }): Promise<InsertedJobRow>;
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
  deleteSchedule(options: { scheduleId: string; tx?: TransactionHandle }): Promise<boolean>;
  /** Arm or disarm a schedule without deleting it (the dashboard's enable/disable action). */
  setScheduleEnabled(options: {
    scheduleId: string;
    enabled: boolean;
    now: number;
    tx?: TransactionHandle;
  }): Promise<boolean>;

  // Claiming & completing (hot path)
  claimJobs(options: {
    queueName: string;
    limit: number;
    lockDurationMs: number;
    now: number;
    /** This instance's multi-instance key, or null when the process is unnamed. */
    instanceKey?: string | null;
  }): Promise<JobRecord[]>;
  extendLock(options: { jobId: string; lockDurationMs: number; now: number }): Promise<boolean>;
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
  reclaimStalledJobs(options: { queueName?: string; now: number }): Promise<JobRecord[]>;
  expireDueJobs(options: { queueName?: string; now: number }): Promise<JobRecord[]>;
  /** Re-arm a failed/completed job's own row so it runs again (manual retry). */
  requeueJob(options: { jobId: string; now: number; tx?: TransactionHandle }): Promise<InsertedJobRow>;

  // Reading
  /**
   * One job row by id. Takes `tx` because a mutating driver method may need to read the row it is
   * about to change: on a single-connection engine (SQLite, PGLite) a read issued outside the
   * in-flight transaction queues *behind* it and deadlocks the connection for good.
   */
  getJob(options: { jobId: string; tx?: TransactionHandle }): Promise<JobRecord | null>;
  getJobs(options: {
    queueName?: string;
    statuses?: JobStatus[];
    scheduleId?: string;
    processedOnInstanceKey?: string;
    limit: number;
    offset: number;
    order: 'asc' | 'desc';
  }): Promise<JobRecord[]>;
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
  countJobs(options: {
    queueName?: string;
    statuses?: JobStatus[];
    scheduleId?: string;
    processedOnInstanceKey?: string;
  }): Promise<number>;
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
  cancelJob(options: { jobId: string; now: number; tx?: TransactionHandle }): Promise<boolean>;
  removeJob(options: { jobId: string; tx?: TransactionHandle }): Promise<boolean>;
  removeJobsByIds(options: {
    jobIds: string[];
    queueName: string;
    tx?: TransactionHandle;
  }): Promise<number>;
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
  }): Promise<void>;
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
  upsertInstance(options: { instanceKey: string; now: number }): Promise<InstanceRow>;
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
  deleteFinishedJobs(options: {
    olderThan: number;
    statuses: JobStatus[];
    limit: number;
    now: number;
  }): Promise<number>;

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
