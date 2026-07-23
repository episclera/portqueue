import type { DatabaseEngine } from '../options/enums.js';
import type { JobStatus } from '../jobs/job-state.enum.js';
import type {
  InsertedJobRow,
  InstanceRow,
  JobRecord,
  NewJobRecord,
  NewScheduleRow,
  QueueRow,
  ScheduleRow,
  ThroughputPoint,
} from '../jobs/job-record.js';
import type { DriverCapability, DriverCapabilitySet } from './driver-capabilities.js';
import type { DriverContext } from './driver-context.js';
import type { TransactionHandle } from '../tx/transaction-handle.js';
import type { QueueOptions } from '../options/queue-options.js';

export interface DriverProbe {
  serverVersion: string;
  verifiedCapabilities: DriverCapability[];
}

export interface Subscription {
  unsubscribe(): Promise<void>;
}

/** Where a manual requeue restarts from. */
export type RequeueFrom = 'FROM_FAILED_STEP' | 'FROM_START';

export interface MigrationStep {
  version: number;
  checksum: string;
  /** Run the migration against the driver in a transaction. */
  up(driver: Driver, context: DriverContext): Promise<void>;
}

/** The next-step descriptor for an atomic workflow advance. */
export interface WorkflowNext {
  workflowStepKey: string;
  data: unknown;
  startAfter: number;
}

/**
 * The database-agnostic seam. ALL SQL and engine-specific behavior
 * lives behind this contract. Core services branch on {@link DriverCapability}, never
 * on driver identity. Every method with >1 argument takes a named-options object.
 */
export interface Driver {
  readonly engine: DatabaseEngine;
  readonly capabilities: DriverCapabilitySet;

  // Identity & lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  probe(): Promise<DriverProbe>;

  // Schema & migration
  getSchemaVersion(): Promise<number | null>;
  applyMigration(options: { migration: MigrationStep }): Promise<void>;
  ensureBaseObjects(options: { context: DriverContext }): Promise<void>;

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

  // Claiming & completing (hot path)
  claimJobs(options: {
    queueName: string;
    limit: number;
    lockDurationMs: number;
    now: number;
    /** Auto-detected identity of this process (recorded as the lock owner). */
    lockedByInstanceId: string;
    /** This instance's multi-instance key, or null in single-instance mode. */
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
  advanceWorkflowStep(options: {
    jobId: string;
    returnValue: unknown;
    now: number;
    next?: WorkflowNext;
    spawn?: NewJobRecord;
    tx?: TransactionHandle;
  }): Promise<InsertedJobRow | null>;
  reclaimStalledJobs(options: { queueName?: string; now: number }): Promise<JobRecord[]>;
  expireDueJobs(options: { queueName?: string; now: number }): Promise<JobRecord[]>;
  requeueJob(options: {
    jobId: string;
    from: RequeueFrom;
    now: number;
    newWorkflowId?: string;
  }): Promise<InsertedJobRow>;

  // Reading
  getJob(options: { jobId: string }): Promise<JobRecord | null>;
  getJobs(options: {
    queueName?: string;
    statuses?: JobStatus[];
    scheduleId?: string;
    workflowId?: string;
    processedOnInstanceKey?: string;
    limit: number;
    offset: number;
    order: 'asc' | 'desc';
  }): Promise<JobRecord[]>;
  countJobsByStatus(options: {
    queueName?: string;
    processedOnInstanceKey?: string;
  }): Promise<Record<JobStatus, number>>;
  listQueues(): Promise<QueueRow[]>;
  listSchedules(options: { queueName?: string }): Promise<ScheduleRow[]>;
  getSchedule(options: { scheduleId: string }): Promise<ScheduleRow | null>;
  getThroughput(options: {
    queueName?: string;
    sinceMs: number;
    now: number;
  }): Promise<ThroughputPoint[]>;
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
  cancelJob(options: { jobId: string; now: number }): Promise<boolean>;
  removeJob(options: { jobId: string; tx?: TransactionHandle }): Promise<boolean>;
  removeJobsByIds(options: { jobIds: string[]; queueName: string }): Promise<number>;
  removeJobsByStatus(options: { queueName: string; statuses: JobStatus[] }): Promise<number>;

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
  getQueueByName(options: { name: string }): Promise<QueueRow | null>;
  /** Delete a queue row by name (manual admin removal; the tool never calls this on its own). */
  deleteQueue(options: { name: string; tx?: TransactionHandle }): Promise<boolean>;

  // Instance liveness & per-instance pause
  upsertInstance(options: {
    instanceKey: string;
    now: number;
  }): Promise<InstanceRow>;
  listInstances(): Promise<InstanceRow[]>;
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
