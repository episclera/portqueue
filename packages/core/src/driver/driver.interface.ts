import type { DatabaseEngine } from '../options/enums.js';
import type { JobStatus } from '../jobs/job-state.enum.js';
import type {
  InsertedJobRow,
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

/** Where a manual requeue restarts from (build_plan/03.2). */
export type RequeueFrom = 'FROM_FAILED_STEP' | 'FROM_START';

export interface MigrationStep {
  version: number;
  checksum: string;
  /** Run the migration against the driver in a transaction. */
  up(driver: Driver, context: DriverContext): Promise<void>;
}

/** The next-step descriptor for an atomic workflow advance (build_plan/03.2). */
export interface WorkflowNext {
  workflowStepKey: string;
  data: unknown;
  startAfter: number;
}

/**
 * The database-agnostic seam (build_plan/03.2). ALL SQL and engine-specific behavior
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
  upsertSchedule(options: {
    schedule: NewScheduleRow;
    tx?: TransactionHandle;
  }): Promise<ScheduleRow>;
  deleteSchedule(options: { scheduleId: string; tx?: TransactionHandle }): Promise<boolean>;

  // Claiming & completing (hot path)
  claimJobs(options: {
    queueId: string;
    limit: number;
    lockDurationMs: number;
    now: number;
    instanceId: string;
    instanceType: string;
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
  reclaimStalledJobs(options: { queueId?: string; now: number }): Promise<JobRecord[]>;
  expireDueJobs(options: { queueId?: string; now: number }): Promise<JobRecord[]>;
  requeueJob(options: {
    jobId: string;
    from: RequeueFrom;
    now: number;
    newWorkflowId?: string;
  }): Promise<InsertedJobRow>;

  // Reading
  getJob(options: { jobId: string }): Promise<JobRecord | null>;
  getJobs(options: {
    queueId?: string;
    statuses?: JobStatus[];
    scheduleId?: string;
    workflowId?: string;
    limit: number;
    offset: number;
    order: 'asc' | 'desc';
  }): Promise<JobRecord[]>;
  countJobsByStatus(options: { queueId?: string }): Promise<Record<JobStatus, number>>;
  listQueues(): Promise<QueueRow[]>;
  listSchedules(options: { queueId?: string }): Promise<ScheduleRow[]>;
  getSchedule(options: { scheduleId: string }): Promise<ScheduleRow | null>;
  getThroughput(options: {
    queueId?: string;
    sinceMs: number;
    now: number;
  }): Promise<ThroughputPoint[]>;
  getDueSchedules(options: { now: number; limit: number }): Promise<ScheduleRow[]>;
  /**
   * Advance a schedule's next-run, guarded on its previous value so only one instance
   * claims each tick (build_plan/06.7). Returns true if this caller won the claim.
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
  removeJobsByIds(options: { jobIds: string[]; queueId: string }): Promise<number>;
  removeJobsByStatus(options: { queueId: string; statuses: JobStatus[] }): Promise<number>;

  // Queue control
  setQueuePaused(options: {
    queueId: string;
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

  // Retention
  deleteFinishedJobs(options: {
    olderThan: number;
    statuses: JobStatus[];
    limit: number;
    now: number;
  }): Promise<number>;

  // Cluster-wide rate-limit usage counter (build_plan/07.4)
  tryConsumeRateLimit(options: {
    queueId: string;
    max: number;
    windowMs: number;
    now: number;
    count: number;
  }): Promise<number>;

  // Pub/sub (only meaningful with LISTEN_NOTIFY)
  notify(options: { channel: string; payload: string }): Promise<void>;
  subscribe(options: {
    channel: string;
    onNotification: (payload: string) => void;
  }): Promise<Subscription>;

  // Transactions (internal use only)
  runInTransaction<T>(options: { fn: (tx: TransactionHandle) => Promise<T> }): Promise<T>;

  // Advisory lock for leader-only tasks (optional; build_plan/03.1)
  tryAdvisoryLock?(options: { key: string }): Promise<boolean>;
  releaseAdvisoryLock?(options: { key: string }): Promise<void>;
}
