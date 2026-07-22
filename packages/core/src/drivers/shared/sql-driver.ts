import { DatabaseEngine, InstanceType, RetentionMode } from '../../options/enums.js';
import { BackoffStrategy } from '../../options/enums.js';
import { JobStatus } from '../../jobs/job-state.enum.js';
import type {
  Driver,
  DriverProbe,
  MigrationStep,
  RequeueFrom,
  Subscription,
  WorkflowNext,
} from '../../driver/driver.interface.js';
import type { DriverCapabilitySet } from '../../driver/driver-capabilities.js';
import { DriverCapability } from '../../driver/driver-capabilities.js';
import type { DriverContext } from '../../driver/driver-context.js';
import { TableName } from '../../schema/table-names.js';
import type {
  InsertedJobRow,
  JobRecord,
  NewJobRecord,
  NewScheduleRow,
  QueueRow,
  ScheduleRow,
  ThroughputPoint,
} from '../../jobs/job-record.js';
import type { QueueOptions } from '../../options/queue-options.js';
import type { TransactionHandle, TxQueryResult } from '../../tx/transaction-handle.js';
import { DriverQueryError, UnsupportedCapabilityError } from '../../errors/errors.js';
import { uuid } from '../../util/uuid.js';

/** A raw query result from the concrete driver. */
export interface RawResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

/** An opaque per-connection session used inside a transaction. */
export type Session = unknown;

type Row = Record<string, unknown>;

const JOB_COLUMNS = [
  'id',
  'queue_id',
  'status',
  'priority',
  'data',
  'return_value',
  'metadata',
  'created_at',
  'updated_at',
  'start_after',
  'expire_at',
  'started_at',
  'completed_at',
  'failed_at',
  'retried_at',
  'stalled_at',
  'cancelled_at',
  'expired_at',
  'locked_until',
  'locked_by_instance_id',
  'run_on_instance_id',
  'run_on_instance_type',
  'retry_attempt',
  'retry_max_attempts',
  'retry_delay_ms',
  'retry_backoff',
  'retry_backoff_factor',
  'retry_max_delay_ms',
  'retry_jitter',
  'failure_message',
  'retention_mode',
  'retention_ttl_ms',
  'idempotency_key',
  'schedule_id',
  'singleton_key',
  'workflow_id',
  'workflow_step_key',
] as const;

/**
 * A SQL-dialect base implementing the whole {@link Driver} contract (build_plan/11.5).
 * Concrete drivers (SQLite, PGLite, Postgres, Oracle) provide only connection management,
 * the placeholder style, and any dialect specifics. No driver method emits a relational
 * JOIN — every relationship is resolved by an id-keyed single-table lookup (build_plan/04.1).
 */
export abstract class SqlDriver implements Driver {
  abstract readonly engine: DatabaseEngine;
  abstract readonly capabilities: DriverCapabilitySet;
  protected context!: DriverContext;

  /** '$1'-style (Postgres), '?'-style (SQLite), or ':1'-style (Oracle) placeholders. */
  protected abstract readonly placeholderStyle: 'dollar' | 'question' | 'colon';

  /** Run a statement, optionally on an in-progress transaction session. */
  protected abstract execute(
    sql: string,
    params: readonly unknown[],
    session?: Session,
  ): Promise<RawResult>;
  /** Run `fn` inside a real DB transaction, serializing on single-connection engines. */
  protected abstract transaction<T>(fn: (session: Session) => Promise<T>): Promise<T>;

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  setContext(context: DriverContext): void {
    this.context = context;
  }

  // --- Naming helpers ---
  protected t(table: TableName): string {
    return this.context.tableNames.bare(table);
  }
  protected get rateTable(): string {
    return `${this.context.tableNames.prefix}rate_usage`;
  }
  protected ph(index0: number): string {
    if (this.placeholderStyle === 'dollar') return `$${index0 + 1}`;
    if (this.placeholderStyle === 'colon') return `:${index0 + 1}`;
    return '?';
  }

  // --- Probe / migration ---
  async probe(): Promise<DriverProbe> {
    return { serverVersion: 'unknown', verifiedCapabilities: this.enabledCapabilities() };
  }

  protected enabledCapabilities(): DriverCapability[] {
    return (Object.keys(this.capabilities) as DriverCapability[]).filter(
      (c) => this.capabilities[c],
    );
  }

  async getSchemaVersion(): Promise<number | null> {
    try {
      const res = await this.execute(
        `SELECT MAX(version) AS v FROM ${this.t(TableName.MIGRATION_STATE)}`,
        [],
      );
      const v = res.rows[0]?.v;
      return v == null ? null : Number(v);
    } catch {
      // Table doesn't exist yet.
      return null;
    }
  }

  async applyMigration(options: { migration: MigrationStep }): Promise<void> {
    const { migration } = options;
    await migration.up(this, this.context);
    const now = Date.now();
    await this.execute(
      `INSERT INTO ${this.t(TableName.MIGRATION_STATE)} (version, applied_at, checksum, created_at, updated_at) VALUES (${this.ph(0)}, ${this.ph(1)}, ${this.ph(2)}, ${this.ph(3)}, ${this.ph(4)})`,
      [migration.version, now, migration.checksum, now, now],
    );
  }

  async ensureBaseObjects(options: { context: DriverContext }): Promise<void> {
    this.context = options.context;
  }

  // --- Value conversion ---
  protected toJson(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
  }
  protected fromJson(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }
  protected boolIn(value: boolean): number {
    return value ? 1 : 0;
  }
  protected boolOut(value: unknown): boolean {
    return value === 1 || value === true || value === '1' || value === 't';
  }
  protected numOrNull(value: unknown): number | null {
    return value == null ? null : Number(value);
  }

  protected mapJob(row: Row): JobRecord {
    return {
      id: String(row.id),
      queueId: String(row.queue_id),
      status: row.status as JobStatus,
      priority: Number(row.priority),
      data: this.fromJson(row.data),
      returnValue: this.fromJson(row.return_value),
      metadata: (this.fromJson(row.metadata) as Record<string, unknown>) ?? {},
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      startAfter: Number(row.start_after),
      expireAt: this.numOrNull(row.expire_at),
      startedAt: this.numOrNull(row.started_at),
      completedAt: this.numOrNull(row.completed_at),
      failedAt: this.numOrNull(row.failed_at),
      retriedAt: this.numOrNull(row.retried_at),
      stalledAt: this.numOrNull(row.stalled_at),
      cancelledAt: this.numOrNull(row.cancelled_at),
      expiredAt: this.numOrNull(row.expired_at),
      lockedUntil: this.numOrNull(row.locked_until),
      lockedByInstanceId: (row.locked_by_instance_id as string) ?? null,
      runOnInstanceId: (row.run_on_instance_id as string) ?? null,
      runOnInstanceType: (row.run_on_instance_type as InstanceType) ?? null,
      retryAttempt: Number(row.retry_attempt),
      retryMaxAttempts: Number(row.retry_max_attempts),
      retryDelayMs: Number(row.retry_delay_ms),
      retryBackoff: row.retry_backoff as BackoffStrategy,
      retryBackoffFactor: this.numOrNull(row.retry_backoff_factor),
      retryMaxDelayMs: this.numOrNull(row.retry_max_delay_ms),
      retryJitter: this.boolOut(row.retry_jitter),
      failureMessage: (row.failure_message as string) ?? null,
      retentionMode: row.retention_mode as RetentionMode,
      retentionTtlMs: this.numOrNull(row.retention_ttl_ms),
      idempotencyKey: (row.idempotency_key as string) ?? null,
      scheduleId: (row.schedule_id as string) ?? null,
      singletonKey: (row.singleton_key as string) ?? null,
      workflowId: (row.workflow_id as string) ?? null,
      workflowStepKey: (row.workflow_step_key as string) ?? null,
    };
  }

  protected mapQueue(row: Row): QueueRow {
    return {
      id: String(row.id),
      name: String(row.name),
      processingPaused: this.boolOut(row.processing_paused),
      acceptingPaused: this.boolOut(row.accepting_paused),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  protected mapSchedule(row: Row): ScheduleRow {
    return {
      id: String(row.id),
      key: String(row.key),
      queueId: String(row.queue_id),
      cron: (row.cron as string) ?? null,
      everyMs: this.numOrNull(row.every_ms),
      timezone: (row.timezone as string) ?? null,
      data: this.fromJson(row.data),
      priority: this.numOrNull(row.priority),
      retryMaxAttempts: this.numOrNull(row.retry_max_attempts),
      retryDelayMs: this.numOrNull(row.retry_delay_ms),
      nextRunAt: this.numOrNull(row.next_run_at),
      lastRunAt: this.numOrNull(row.last_run_at),
      enabled: this.boolOut(row.enabled),
      startAt: this.numOrNull(row.start_at),
      endAt: this.numOrNull(row.end_at),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  // --- Producing ---
  protected jobInsertValues(job: NewJobRecord): { columns: string[]; values: unknown[] } {
    const id = job.id ?? uuid();
    const now = job.createdAt;
    const columns = [...JOB_COLUMNS];
    const values: unknown[] = [
      id,
      job.queueId,
      job.status,
      job.priority,
      this.toJson(job.data),
      null, // return_value
      this.toJson(job.metadata),
      now,
      now,
      job.startAfter,
      job.expireAt,
      null, // started_at
      null, // completed_at
      null, // failed_at
      null, // retried_at
      null, // stalled_at
      null, // cancelled_at
      null, // expired_at
      null, // locked_until
      null, // locked_by_instance_id
      job.runOnInstanceId,
      job.runOnInstanceType,
      job.retryAttempt,
      job.retryMaxAttempts,
      job.retryDelayMs,
      job.retryBackoff,
      job.retryBackoffFactor,
      job.retryMaxDelayMs,
      this.boolIn(job.retryJitter),
      null, // failure_message
      job.retentionMode,
      job.retentionTtlMs,
      job.idempotencyKey,
      job.scheduleId,
      job.singletonKey,
      job.workflowId,
      job.workflowStepKey,
    ];
    return { columns, values };
  }

  private async runMaybeTx(
    sql: string,
    params: unknown[],
    tx?: TransactionHandle,
  ): Promise<RawResult> {
    if (tx) {
      const res: TxQueryResult = await tx.execute(sql, params);
      return { rows: res.rows, rowCount: res.rowCount };
    }
    return this.execute(sql, params);
  }

  async insertJob(options: { job: NewJobRecord; tx?: TransactionHandle }): Promise<InsertedJobRow> {
    const { job, tx } = options;
    const { columns, values } = this.jobInsertValues(job);
    const placeholders = values.map((_, i) => this.ph(i)).join(', ');
    const sql = `INSERT INTO ${this.t(TableName.JOB)} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id, status, start_after, workflow_id`;
    try {
      const res = await this.runMaybeTx(sql, values, tx);
      const row = res.rows[0]!;
      return {
        id: String(row.id),
        status: row.status as JobStatus,
        startAfter: Number(row.start_after),
        workflowId: (row.workflow_id as string) ?? null,
        deduplicated: false,
      };
    } catch (err) {
      const existing = await this.findDeduplicated(job);
      if (existing) return existing;
      throw new DriverQueryError(`Failed to insert job on queue '${job.queueId}'.`, err);
    }
  }

  /** After a unique-constraint violation, locate the existing job to return (build_plan/06.6). */
  private async findDeduplicated(job: NewJobRecord): Promise<InsertedJobRow | null> {
    if (job.idempotencyKey) {
      const res = await this.execute(
        `SELECT id, status, start_after, workflow_id FROM ${this.t(TableName.JOB)} WHERE queue_id = ${this.ph(0)} AND idempotency_key = ${this.ph(1)}`,
        [job.queueId, job.idempotencyKey],
      );
      if (res.rows[0]) {
        const row = res.rows[0];
        return {
          id: String(row.id),
          status: row.status as JobStatus,
          startAfter: Number(row.start_after),
          workflowId: (row.workflow_id as string) ?? null,
          deduplicated: true,
          deduplicationReason: 'IDEMPOTENCY',
        };
      }
    }
    if (job.singletonKey) {
      const res = await this.execute(
        `SELECT id, status, start_after, workflow_id FROM ${this.t(TableName.JOB)} WHERE queue_id = ${this.ph(0)} AND singleton_key = ${this.ph(1)} AND status IN ('PENDING','ACTIVE','RETRY')`,
        [job.queueId, job.singletonKey],
      );
      if (res.rows[0]) {
        const row = res.rows[0];
        return {
          id: String(row.id),
          status: row.status as JobStatus,
          startAfter: Number(row.start_after),
          workflowId: (row.workflow_id as string) ?? null,
          deduplicated: true,
          deduplicationReason: 'SINGLETON',
        };
      }
    }
    return null;
  }

  async insertJobs(options: {
    jobs: NewJobRecord[];
    tx?: TransactionHandle;
  }): Promise<InsertedJobRow[]> {
    const results: InsertedJobRow[] = [];
    for (const job of options.jobs) {
      results.push(await this.insertJob({ job, ...(options.tx ? { tx: options.tx } : {}) }));
    }
    return results;
  }

  async upsertSchedule(options: {
    schedule: NewScheduleRow;
    tx?: TransactionHandle;
  }): Promise<ScheduleRow> {
    const { schedule, tx } = options;
    const id = schedule.id ?? uuid();
    const now = Date.now();
    // Idempotent on (queue_id, key). Update the definition if it already exists.
    const cols = [
      'id',
      'key',
      'queue_id',
      'cron',
      'every_ms',
      'timezone',
      'data',
      'priority',
      'retry_max_attempts',
      'retry_delay_ms',
      'next_run_at',
      'enabled',
      'start_at',
      'end_at',
      'created_at',
      'updated_at',
    ];
    const vals: unknown[] = [
      id,
      schedule.key,
      schedule.queueId,
      schedule.cron,
      schedule.everyMs,
      schedule.timezone,
      this.toJson(schedule.data),
      schedule.priority,
      schedule.retryMaxAttempts,
      schedule.retryDelayMs,
      schedule.nextRunAt,
      this.boolIn(schedule.enabled),
      schedule.startAt,
      schedule.endAt,
      now,
      now,
    ];
    const placeholders = vals.map((_, i) => this.ph(i)).join(', ');
    const sql =
      `INSERT INTO ${this.t(TableName.SCHEDULE)} (${cols.join(', ')}) VALUES (${placeholders}) ` +
      `ON CONFLICT (queue_id, key) DO UPDATE SET ` +
      `cron = excluded.cron, every_ms = excluded.every_ms, timezone = excluded.timezone, data = excluded.data, ` +
      `priority = excluded.priority, retry_max_attempts = excluded.retry_max_attempts, retry_delay_ms = excluded.retry_delay_ms, ` +
      `next_run_at = excluded.next_run_at, enabled = excluded.enabled, start_at = excluded.start_at, end_at = excluded.end_at, updated_at = excluded.updated_at ` +
      `RETURNING *`;
    const res = await this.runMaybeTx(sql, vals, tx);
    return this.mapSchedule(res.rows[0]!);
  }

  async deleteSchedule(options: { scheduleId: string; tx?: TransactionHandle }): Promise<boolean> {
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.SCHEDULE)} WHERE id = ${this.ph(0)}`,
      [options.scheduleId],
      options.tx,
    );
    return res.rowCount > 0;
  }

  // --- Claiming (hot path) ---
  async claimJobs(options: {
    queueId: string;
    limit: number;
    lockDurationMs: number;
    now: number;
    instanceId: string;
    instanceType: string;
  }): Promise<JobRecord[]> {
    const { queueId, limit, lockDurationMs, now, instanceId, instanceType } = options;
    const lockedUntil = now + lockDurationMs;
    const skipLocked = this.capabilities[DriverCapability.SKIP_LOCKED]
      ? ' FOR UPDATE SKIP LOCKED'
      : '';
    const cols = JOB_COLUMNS.join(', ');
    // A single guarded UPDATE ... WHERE id IN (candidate subquery) RETURNING — atomic on both
    // strategies (SKIP LOCKED on PG-family; SQLite's single-writer makes the guard exclusive).
    const build = (session?: Session) =>
      this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET status = 'ACTIVE', started_at = ${this.ph(0)}, locked_until = ${this.ph(1)}, ` +
          `locked_by_instance_id = ${this.ph(2)}, run_on_instance_id = ${this.ph(3)}, run_on_instance_type = ${this.ph(4)}, updated_at = ${this.ph(5)} ` +
          `WHERE id IN (SELECT id FROM ${this.t(TableName.JOB)} WHERE queue_id = ${this.ph(6)} AND status IN ('PENDING','RETRY') ` +
          `AND start_after <= ${this.ph(7)} AND (expire_at IS NULL OR expire_at > ${this.ph(8)}) ` +
          `ORDER BY priority DESC, start_after ASC LIMIT ${this.ph(9)}${skipLocked}) RETURNING ${cols}`,
        [now, lockedUntil, instanceId, instanceId, instanceType, now, queueId, now, now, limit],
        session,
      );
    const res = this.capabilities[DriverCapability.SKIP_LOCKED]
      ? await this.transaction((session) => build(session))
      : await build();
    // RETURNING does not preserve the subquery's ORDER BY, so re-sort the claimed batch by
    // the claim ordering (priority DESC, start_after ASC) for deterministic dispatch.
    return res.rows
      .map((r) => this.mapJob(r))
      .sort((a, b) => b.priority - a.priority || a.startAfter - b.startAfter);
  }

  async extendLock(options: {
    jobId: string;
    lockDurationMs: number;
    now: number;
  }): Promise<boolean> {
    const res = await this.execute(
      `UPDATE ${this.t(TableName.JOB)} SET locked_until = ${this.ph(0)}, updated_at = ${this.ph(1)} WHERE id = ${this.ph(2)} AND status = 'ACTIVE'`,
      [options.now + options.lockDurationMs, options.now, options.jobId],
    );
    return res.rowCount > 0;
  }

  async completeJob(options: {
    jobId: string;
    returnValue?: unknown;
    now: number;
    tx?: TransactionHandle;
  }): Promise<void> {
    await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET status = 'COMPLETED', return_value = ${this.ph(0)}, completed_at = ${this.ph(1)}, updated_at = ${this.ph(2)}, locked_until = NULL WHERE id = ${this.ph(3)}`,
      [this.toJson(options.returnValue), options.now, options.now, options.jobId],
      options.tx,
    );
  }

  async retryJob(options: {
    jobId: string;
    nextRunAt: number;
    retryAttempt: number;
    lastError: string;
    now: number;
  }): Promise<void> {
    await this.execute(
      `UPDATE ${this.t(TableName.JOB)} SET status = 'RETRY', retry_attempt = ${this.ph(0)}, start_after = ${this.ph(1)}, retried_at = ${this.ph(2)}, failure_message = ${this.ph(3)}, updated_at = ${this.ph(4)}, locked_until = NULL WHERE id = ${this.ph(5)}`,
      [
        options.retryAttempt,
        options.nextRunAt,
        options.now,
        options.lastError,
        options.now,
        options.jobId,
      ],
    );
  }

  async failJob(options: { jobId: string; lastError: string; now: number }): Promise<void> {
    await this.execute(
      `UPDATE ${this.t(TableName.JOB)} SET status = 'FAILED', failed_at = ${this.ph(0)}, failure_message = ${this.ph(1)}, updated_at = ${this.ph(2)}, locked_until = NULL WHERE id = ${this.ph(3)}`,
      [options.now, options.lastError, options.now, options.jobId],
    );
  }

  async advanceWorkflowStep(options: {
    jobId: string;
    returnValue: unknown;
    now: number;
    next?: WorkflowNext;
    spawn?: NewJobRecord;
    tx?: TransactionHandle;
  }): Promise<InsertedJobRow | null> {
    // Complete-this + spawn-next in ONE transaction (build_plan/03.2 / 06.8).
    return this.transaction(async (session) => {
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET status = 'COMPLETED', return_value = ${this.ph(0)}, completed_at = ${this.ph(1)}, updated_at = ${this.ph(2)}, locked_until = NULL WHERE id = ${this.ph(3)}`,
        [this.toJson(options.returnValue), options.now, options.now, options.jobId],
        session,
      );
      if (!options.spawn) return null;
      const { columns, values } = this.jobInsertValues(options.spawn);
      const placeholders = values.map((_, i) => this.ph(i)).join(', ');
      const res = await this.execute(
        `INSERT INTO ${this.t(TableName.JOB)} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id, status, start_after, workflow_id`,
        values,
        session,
      );
      const row = res.rows[0]!;
      return {
        id: String(row.id),
        status: row.status as JobStatus,
        startAfter: Number(row.start_after),
        workflowId: (row.workflow_id as string) ?? null,
        deduplicated: false,
      };
    });
  }

  async reclaimStalledJobs(options: { queueId?: string; now: number }): Promise<JobRecord[]> {
    const cols = JOB_COLUMNS.join(', ');
    const params: unknown[] = [options.now, options.now];
    let where = `status = 'ACTIVE' AND locked_until IS NOT NULL AND locked_until < ${this.ph(1)}`;
    if (options.queueId) {
      where += ` AND queue_id = ${this.ph(2)}`;
      params.push(options.queueId);
    }
    // Return stalled jobs to PENDING (RETRY handling happens in the completion path on next fail).
    const res = await this.execute(
      `UPDATE ${this.t(TableName.JOB)} SET status = 'PENDING', stalled_at = ${this.ph(0)}, locked_until = NULL, locked_by_instance_id = NULL WHERE ${where} RETURNING ${cols}`,
      params,
    );
    return res.rows.map((r) => this.mapJob(r));
  }

  async expireDueJobs(options: { queueId?: string; now: number }): Promise<JobRecord[]> {
    const cols = JOB_COLUMNS.join(', ');
    const params: unknown[] = [options.now, options.now, options.now];
    let where = `status IN ('PENDING','RETRY') AND expire_at IS NOT NULL AND expire_at <= ${this.ph(2)}`;
    if (options.queueId) {
      where += ` AND queue_id = ${this.ph(3)}`;
      params.push(options.queueId);
    }
    const res = await this.execute(
      `UPDATE ${this.t(TableName.JOB)} SET status = 'EXPIRED', expired_at = ${this.ph(0)}, updated_at = ${this.ph(1)}, locked_until = NULL WHERE ${where} RETURNING ${cols}`,
      params,
    );
    return res.rows.map((r) => this.mapJob(r));
  }

  async requeueJob(options: {
    jobId: string;
    from: RequeueFrom;
    now: number;
    newWorkflowId?: string;
  }): Promise<InsertedJobRow> {
    const job = await this.getJob({ jobId: options.jobId });
    if (!job) throw new DriverQueryError(`Cannot requeue: job '${options.jobId}' not found.`);
    if (options.from === 'FROM_FAILED_STEP') {
      // Re-arm this job's own row: back to PENDING, reset retry counters/lock/timestamps.
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET status = 'PENDING', retry_attempt = 0, start_after = ${this.ph(0)}, ` +
          `failed_at = NULL, failure_message = NULL, completed_at = NULL, started_at = NULL, cancelled_at = NULL, expired_at = NULL, ` +
          `locked_until = NULL, locked_by_instance_id = NULL, updated_at = ${this.ph(1)} WHERE id = ${this.ph(2)}`,
        [options.now, options.now, options.jobId],
      );
      return {
        id: job.id,
        status: JobStatus.PENDING,
        startAfter: options.now,
        workflowId: job.workflowId,
        deduplicated: false,
      };
    }
    // FROM_START: for a workflow, find the entry-step job of the run; else clone this job fresh.
    let seed = job;
    if (job.workflowId) {
      const entry = await this.execute(
        `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} WHERE workflow_id = ${this.ph(0)} ORDER BY created_at ASC LIMIT 1`,
        [job.workflowId],
      );
      if (entry.rows[0]) seed = this.mapJob(entry.rows[0]);
    }
    const newWorkflowId = job.workflowId ? (options.newWorkflowId ?? uuid()) : null;
    const fresh: NewJobRecord = {
      queueId: seed.queueId,
      status: JobStatus.PENDING,
      priority: seed.priority,
      data: seed.data,
      metadata: seed.metadata,
      startAfter: options.now,
      expireAt: null,
      retryAttempt: 0,
      retryMaxAttempts: seed.retryMaxAttempts,
      retryDelayMs: seed.retryDelayMs,
      retryBackoff: seed.retryBackoff,
      retryBackoffFactor: seed.retryBackoffFactor,
      retryMaxDelayMs: seed.retryMaxDelayMs,
      retryJitter: seed.retryJitter,
      retentionMode: seed.retentionMode,
      retentionTtlMs: seed.retentionTtlMs,
      idempotencyKey: null,
      scheduleId: seed.scheduleId,
      singletonKey: null,
      workflowId: newWorkflowId,
      workflowStepKey: newWorkflowId ? seed.workflowStepKey : null,
      runOnInstanceId: null,
      runOnInstanceType: null,
      createdAt: options.now,
    };
    return this.insertJob({ job: fresh });
  }

  // --- Reading ---
  async getJob(options: { jobId: string }): Promise<JobRecord | null> {
    const res = await this.execute(
      `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} WHERE id = ${this.ph(0)}`,
      [options.jobId],
    );
    return res.rows[0] ? this.mapJob(res.rows[0]) : null;
  }

  async getJobs(options: {
    queueId?: string;
    statuses?: JobStatus[];
    scheduleId?: string;
    workflowId?: string;
    limit: number;
    offset: number;
    order: 'asc' | 'desc';
  }): Promise<JobRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.queueId) {
      clauses.push(`queue_id = ${this.ph(params.length)}`);
      params.push(options.queueId);
    }
    if (options.statuses && options.statuses.length) {
      const ph = options.statuses.map((_, i) => this.ph(params.length + i)).join(', ');
      clauses.push(`status IN (${ph})`);
      params.push(...options.statuses);
    }
    if (options.scheduleId) {
      clauses.push(`schedule_id = ${this.ph(params.length)}`);
      params.push(options.scheduleId);
    }
    if (options.workflowId) {
      clauses.push(`workflow_id = ${this.ph(params.length)}`);
      params.push(options.workflowId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limitPh = this.ph(params.length);
    params.push(options.limit);
    const offsetPh = this.ph(params.length);
    params.push(options.offset);
    const res = await this.execute(
      `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} ${where} ORDER BY created_at ${options.order === 'asc' ? 'ASC' : 'DESC'} LIMIT ${limitPh} OFFSET ${offsetPh}`,
      params,
    );
    return res.rows.map((r) => this.mapJob(r));
  }

  async countJobsByStatus(options: { queueId?: string }): Promise<Record<JobStatus, number>> {
    const params: unknown[] = [];
    let where = '';
    if (options.queueId) {
      where = `WHERE queue_id = ${this.ph(0)}`;
      params.push(options.queueId);
    }
    const res = await this.execute(
      `SELECT status, COUNT(*) AS c FROM ${this.t(TableName.JOB)} ${where} GROUP BY status`,
      params,
    );
    const counts = emptyStatusCounts();
    for (const row of res.rows) {
      counts[row.status as JobStatus] = Number(row.c);
    }
    return counts;
  }

  async listQueues(): Promise<QueueRow[]> {
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.QUEUE)} ORDER BY name ASC`,
      [],
    );
    return res.rows.map((r) => this.mapQueue(r));
  }

  async listSchedules(options: { queueId?: string }): Promise<ScheduleRow[]> {
    const params: unknown[] = [];
    let where = '';
    if (options.queueId) {
      where = `WHERE queue_id = ${this.ph(0)}`;
      params.push(options.queueId);
    }
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} ${where} ORDER BY created_at ASC`,
      params,
    );
    return res.rows.map((r) => this.mapSchedule(r));
  }

  async getSchedule(options: { scheduleId: string }): Promise<ScheduleRow | null> {
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} WHERE id = ${this.ph(0)}`,
      [options.scheduleId],
    );
    return res.rows[0] ? this.mapSchedule(res.rows[0]) : null;
  }

  async getThroughput(options: {
    queueId?: string;
    sinceMs: number;
    now: number;
  }): Promise<ThroughputPoint[]> {
    const params: unknown[] = [options.sinceMs];
    let where = `(completed_at IS NOT NULL OR failed_at IS NOT NULL) AND updated_at >= ${this.ph(0)}`;
    if (options.queueId) {
      where += ` AND queue_id = ${this.ph(1)}`;
      params.push(options.queueId);
    }
    const res = await this.execute(
      `SELECT status, completed_at, failed_at FROM ${this.t(TableName.JOB)} WHERE ${where}`,
      params,
    );
    // Bucket by minute in-memory (avoids engine-specific date functions).
    const buckets = new Map<number, ThroughputPoint>();
    for (const row of res.rows) {
      const ts = row.completed_at != null ? Number(row.completed_at) : Number(row.failed_at);
      const bucket = Math.floor(ts / 60000) * 60000;
      const point = buckets.get(bucket) ?? { bucketStart: bucket, completed: 0, failed: 0 };
      if (row.status === JobStatus.COMPLETED) point.completed += 1;
      else if (row.status === JobStatus.FAILED) point.failed += 1;
      buckets.set(bucket, point);
    }
    return [...buckets.values()].sort((a, b) => a.bucketStart - b.bucketStart);
  }

  async getDueSchedules(options: { now: number; limit: number }): Promise<ScheduleRow[]> {
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ${this.ph(0)} ORDER BY next_run_at ASC LIMIT ${this.ph(1)}`,
      [options.now, options.limit],
    );
    return res.rows.map((r) => this.mapSchedule(r));
  }

  async advanceSchedule(options: {
    scheduleId: string;
    nextRunAt: number | null;
    lastRunAt: number;
    fromNextRunAt: number;
  }): Promise<boolean> {
    // Guarded on the previous next_run_at: only one instance claims each tick.
    const res = await this.execute(
      `UPDATE ${this.t(TableName.SCHEDULE)} SET next_run_at = ${this.ph(0)}, last_run_at = ${this.ph(1)}, updated_at = ${this.ph(2)} WHERE id = ${this.ph(3)} AND next_run_at = ${this.ph(4)}`,
      [
        options.nextRunAt,
        options.lastRunAt,
        options.lastRunAt,
        options.scheduleId,
        options.fromNextRunAt,
      ],
    );
    return res.rowCount > 0;
  }

  // --- Job control ---
  async cancelJob(options: { jobId: string; now: number }): Promise<boolean> {
    const res = await this.execute(
      `UPDATE ${this.t(TableName.JOB)} SET status = 'CANCELLED', cancelled_at = ${this.ph(0)}, updated_at = ${this.ph(1)} WHERE id = ${this.ph(2)} AND status IN ('PENDING','RETRY')`,
      [options.now, options.now, options.jobId],
    );
    return res.rowCount > 0;
  }

  async removeJob(options: { jobId: string; tx?: TransactionHandle }): Promise<boolean> {
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE id = ${this.ph(0)}`,
      [options.jobId],
      options.tx,
    );
    return res.rowCount > 0;
  }

  async removeJobsByIds(options: { jobIds: string[]; queueId: string }): Promise<number> {
    if (!options.jobIds.length) return 0;
    const idPh = options.jobIds.map((_, i) => this.ph(i)).join(', ');
    // Placeholder appearance order (IN list, then queue_id) must match the params array
    // so positional-bind engines (SQLite '?') and indexed engines ('$n') both work.
    const res = await this.execute(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE id IN (${idPh}) AND queue_id = ${this.ph(options.jobIds.length)}`,
      [...options.jobIds, options.queueId],
    );
    return res.rowCount;
  }

  async removeJobsByStatus(options: { queueId: string; statuses: JobStatus[] }): Promise<number> {
    if (!options.statuses.length) return 0;
    const statusPh = options.statuses.map((_, i) => this.ph(i)).join(', ');
    const res = await this.execute(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE status IN (${statusPh}) AND queue_id = ${this.ph(options.statuses.length)}`,
      [...options.statuses, options.queueId],
    );
    return res.rowCount;
  }

  // --- Queue control ---
  async setQueuePaused(options: {
    queueId: string;
    processingPaused?: boolean;
    acceptingPaused?: boolean;
    now: number;
    tx?: TransactionHandle;
  }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (options.processingPaused !== undefined) {
      sets.push(`processing_paused = ${this.ph(params.length)}`);
      params.push(this.boolIn(options.processingPaused));
    }
    if (options.acceptingPaused !== undefined) {
      sets.push(`accepting_paused = ${this.ph(params.length)}`);
      params.push(this.boolIn(options.acceptingPaused));
    }
    sets.push(`updated_at = ${this.ph(params.length)}`);
    params.push(options.now);
    params.push(options.queueId);
    await this.runMaybeTx(
      `UPDATE ${this.t(TableName.QUEUE)} SET ${sets.join(', ')} WHERE id = ${this.ph(params.length - 1)}`,
      params,
      options.tx,
    );
  }

  async ensureQueue(options: {
    name: string;
    options?: QueueOptions;
    now: number;
    tx?: TransactionHandle;
  }): Promise<QueueRow> {
    const existing = await this.getQueueByName({ name: options.name });
    if (existing) return existing;
    const id = uuid();
    // Idempotent INSERT ... ON CONFLICT DO NOTHING on the unique name; first writer wins.
    await this.runMaybeTx(
      `INSERT INTO ${this.t(TableName.QUEUE)} (id, name, processing_paused, accepting_paused, created_at, updated_at) VALUES (${this.ph(0)}, ${this.ph(1)}, 0, 0, ${this.ph(2)}, ${this.ph(3)}) ON CONFLICT (name) DO NOTHING`,
      [id, options.name, options.now, options.now],
      options.tx,
    );
    const row = await this.getQueueByName({ name: options.name });
    if (!row) throw new DriverQueryError(`Failed to ensure queue '${options.name}'.`);
    return row;
  }

  async getQueueByName(options: { name: string }): Promise<QueueRow | null> {
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.QUEUE)} WHERE name = ${this.ph(0)}`,
      [options.name],
    );
    return res.rows[0] ? this.mapQueue(res.rows[0]) : null;
  }

  // --- Retention ---
  async deleteFinishedJobs(options: {
    olderThan: number;
    statuses: JobStatus[];
    limit: number;
    now: number;
  }): Promise<number> {
    if (!options.statuses.length) return 0;
    const statusPh = options.statuses.map((_, i) => this.ph(i)).join(', ');
    const cutoffPh = this.ph(options.statuses.length);
    const limitPh = this.ph(options.statuses.length + 1);
    // Bounded batch: delete finished rows whose retention window has elapsed.
    const res = await this.execute(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE id IN (SELECT id FROM ${this.t(TableName.JOB)} WHERE status IN (${statusPh}) ` +
        `AND retention_mode = 'DELETE_AFTER' AND retention_ttl_ms IS NOT NULL ` +
        `AND (COALESCE(completed_at, failed_at, cancelled_at, expired_at, updated_at) + retention_ttl_ms) <= ${cutoffPh} LIMIT ${limitPh})`,
      [...options.statuses, options.olderThan, options.limit],
    );
    return res.rowCount;
  }

  // --- Rate limit usage counter (build_plan/07.4) ---
  async tryConsumeRateLimit(options: {
    queueId: string;
    max: number;
    windowMs: number;
    now: number;
    count: number;
  }): Promise<number> {
    return this.transaction(async (session) => {
      const windowStart = Math.floor(options.now / options.windowMs) * options.windowMs;
      const res = await this.execute(
        `SELECT window_start, used FROM ${this.rateTable} WHERE queue_id = ${this.ph(0)}`,
        [options.queueId],
        session,
      );
      const row = res.rows[0];
      let used = 0;
      if (!row || Number(row.window_start) !== windowStart) {
        await this.execute(
          `INSERT INTO ${this.rateTable} (queue_id, window_start, used) VALUES (${this.ph(0)}, ${this.ph(1)}, 0) ON CONFLICT (queue_id) DO UPDATE SET window_start = ${this.ph(2)}, used = 0`,
          [options.queueId, windowStart, windowStart],
          session,
        );
        used = 0;
      } else {
        used = Number(row.used);
      }
      const grant = Math.max(0, Math.min(options.count, options.max - used));
      if (grant > 0) {
        await this.execute(
          `UPDATE ${this.rateTable} SET used = used + ${this.ph(0)} WHERE queue_id = ${this.ph(1)}`,
          [grant, options.queueId],
          session,
        );
      }
      return grant;
    });
  }

  // --- Pub/sub (default: unsupported; PG overrides) ---
  async notify(_options: { channel: string; payload: string }): Promise<void> {
    // No-op when LISTEN/NOTIFY is unsupported; the safety poll backstops it.
  }

  async subscribe(_options: {
    channel: string;
    onNotification: (payload: string) => void;
  }): Promise<Subscription> {
    throw new UnsupportedCapabilityError(
      DriverCapability.LISTEN_NOTIFY,
      'This driver uses interval polling instead. Core should not call subscribe() without the LISTEN_NOTIFY capability.',
    );
  }

  // --- Transactions (internal) ---
  async runInTransaction<T>(options: { fn: (tx: TransactionHandle) => Promise<T> }): Promise<T> {
    return this.transaction(async (session) => {
      const handle: TransactionHandle = {
        __portqueueTx: true,
        engine: this.engine,
        execute: async (sql, params) => {
          const res = await this.execute(sql, params, session);
          return { rows: res.rows, rowCount: res.rowCount };
        },
      };
      return options.fn(handle);
    });
  }
}

function emptyStatusCounts(): Record<JobStatus, number> {
  return {
    [JobStatus.PENDING]: 0,
    [JobStatus.ACTIVE]: 0,
    [JobStatus.COMPLETED]: 0,
    [JobStatus.FAILED]: 0,
    [JobStatus.RETRY]: 0,
    [JobStatus.CANCELLED]: 0,
    [JobStatus.EXPIRED]: 0,
  };
}
