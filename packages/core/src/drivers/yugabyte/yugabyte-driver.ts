import { createHash } from 'node:crypto';
import {
  DatabaseEngine,
  DeduplicationReason,
  RetentionMode,
  BackoffStrategy,
} from '../../options/enums';
import { JobStatus } from '../../jobs/job-state.enum';
import {
  capabilities,
  DriverCapability,
  type DriverCapabilitySet,
} from '../driver-capabilities';
import {
  DriverConnectionError,
  DriverQueryError,
  MissingPeerDependencyError,
  UnsupportedCapabilityError,
} from '../../errors/errors';
import {
  TableName,
  QueueColumn,
  JobColumn,
  ScheduleColumn,
  InstanceColumn,
  MigrationColumn,
} from '../table-names';
import { matchesInstance } from '../../jobs/instance-affinity';
import { uuid } from '../../util/uuid';
import { toMigrationSteps } from '../shared/migration';
import { YUGABYTE_MIGRATIONS } from './migrations';
import type {
  Driver,
  DriverProbe,
  MigrationStep,
  RequeueFrom,
  Subscription,
  WorkflowNext,
} from '../driver.interface';
import type { DriverContext } from '../driver-context';
import type {
  InsertedJobRow,
  InstanceRow,
  JobRecord,
  NewJobRecord,
  NewScheduleRow,
  QueueRow,
  ScheduleRow,
  ThroughputPoint,
} from '../../jobs/job-record';
import type { QueueOptions } from '../../options/queue-options';
import type { TransactionHandle, TxQueryResult } from '../../tx/transaction-handle';

export interface YugabyteDriverOptions {
  connectionString?: string;
  /** An existing `pg.Pool` to share with the app. */
  pool?: unknown;
  /** Any `pg.PoolConfig` (host/user/password/database/…). */
  config?: Record<string, unknown>;
}

interface PgQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}
interface PgClient {
  query(sql: string, params?: readonly unknown[]): Promise<PgQueryResult>;
  release(): void;
  on(event: string, cb: (msg: { channel: string; payload?: string }) => void): void;
}
interface PgPool {
  query(sql: string, params?: readonly unknown[]): Promise<PgQueryResult>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}

/** A raw query result. */
interface RawResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}
/** An opaque per-connection session used inside a transaction. */
type Session = unknown;
type Row = Record<string, unknown>;

const JOB_COLUMNS = [
  JobColumn.ID,
  JobColumn.QUEUE_NAME,
  JobColumn.STATUS,
  JobColumn.PRIORITY,
  JobColumn.DATA,
  JobColumn.RETURN_VALUE,
  JobColumn.METADATA,
  JobColumn.CREATED_AT,
  JobColumn.UPDATED_AT,
  JobColumn.START_AFTER,
  JobColumn.EXPIRE_AT,
  JobColumn.STARTED_AT,
  JobColumn.COMPLETED_AT,
  JobColumn.FAILED_AT,
  JobColumn.RETRIED_AT,
  JobColumn.STALLED_AT,
  JobColumn.CANCELLED_AT,
  JobColumn.EXPIRED_AT,
  JobColumn.LOCKED_UNTIL,
  JobColumn.LOCKED_BY_INSTANCE_ID,
  JobColumn.PREFERRED_INSTANCE_KEY_PATTERN,
  JobColumn.PROCESSED_ON_INSTANCE_KEY,
  JobColumn.RETRY_ATTEMPT,
  JobColumn.RETRY_MAX_ATTEMPTS,
  JobColumn.RETRY_DELAY_MS,
  JobColumn.RETRY_BACKOFF,
  JobColumn.RETRY_BACKOFF_FACTOR,
  JobColumn.RETRY_MAX_DELAY_MS,
  JobColumn.RETRY_JITTER,
  JobColumn.FAILURE_MESSAGE,
  JobColumn.RETENTION_MODE,
  JobColumn.RETENTION_TTL_MS,
  JobColumn.IDEMPOTENCY_KEY,
  JobColumn.SCHEDULE_ID,
  JobColumn.SINGLETON_KEY,
  JobColumn.WORKFLOW_ID,
  JobColumn.WORKFLOW_STEP_KEY,
] as const;

/**
 * Yugabyte driver — YugabyteDB's YSQL API, distributed Postgres over the `pg` wire protocol.
 * Standalone: it owns its entire SQL surface (no shared base) so a Yugabyte-specific change never
 * touches another engine. `$1`-style placeholders, advisory locks, SKIP LOCKED claiming, RETURNING
 * everywhere — but YSQL has no LISTEN/NOTIFY, so that capability is off and the polling backstop
 * drives wakeups. No method emits a relational JOIN — relationships resolve by name/key lookups,
 * and the schema carries no unique index, so name-uniqueness and idempotency/singleton dedup are
 * enforced here in code. `pg` is an optional peer dependency.
 */
export class YugabyteDriver implements Driver {
  readonly engine = DatabaseEngine.YUGABYTE;
  readonly capabilities: DriverCapabilitySet = capabilities({
    [DriverCapability.SKIP_LOCKED]: true,
    [DriverCapability.RETURNING]: true,
    [DriverCapability.TRANSACTIONS]: true,
    // YSQL does not implement LISTEN/NOTIFY — rely on interval polling.
    [DriverCapability.ADVISORY_LOCK]: true,
  });
  readonly migrations = toMigrationSteps(YUGABYTE_MIGRATIONS);

  protected context!: DriverContext;
  private pool: PgPool | null = null;
  private readonly options: YugabyteDriverOptions;

  constructor(options: YugabyteDriverOptions = {}) {
    this.options = options;
  }

  setContext(context: DriverContext): void {
    this.context = context;
  }

  // --- Connection management ---
  async connect(): Promise<void> {
    if (this.options.pool) {
      this.pool = this.options.pool as PgPool;
      return;
    }
    let pg: { Pool: new (config?: Record<string, unknown>) => PgPool };
    try {
      // Dynamic specifier so TS doesn't require the optional peer's types at build time.
      const mod = (await import('pg' as string)) as { default?: { Pool: PgPool }; Pool?: PgPool };
      pg = (mod.default ?? mod) as unknown as {
        Pool: new (config?: Record<string, unknown>) => PgPool;
      };
    } catch {
      throw new MissingPeerDependencyError('pg', 'Yugabyte');
    }
    try {
      const config: Record<string, unknown> = { ...this.options.config };
      if (this.options.connectionString) config.connectionString = this.options.connectionString;
      this.pool = new pg.Pool(config);
      await this.pool.query('SELECT 1');
    } catch (err) {
      throw new DriverConnectionError('Failed to connect to Yugabyte.', err);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool && !this.options.pool) await this.pool.end();
    this.pool = null;
  }

  private async execute(
    sql: string,
    params: readonly unknown[],
    session?: Session,
  ): Promise<RawResult> {
    const target = (session as PgClient | undefined) ?? this.pool;
    if (!target) throw new DriverConnectionError('Yugabyte driver is not connected.');
    const res = await target.query(sql, params);
    return { rows: res.rows ?? [], rowCount: res.rowCount ?? res.rows?.length ?? 0 };
  }

  private async transaction<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    if (!this.pool) throw new DriverConnectionError('Yugabyte driver is not connected.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  // --- Naming helpers ---
  private t(table: TableName): string {
    return this.context.tableNames.bare(table);
  }
  /** Postgres uses `$1`-style positional placeholders. */
  private ph(index0: number): string {
    return `$${index0 + 1}`;
  }

  // --- Probe / migration ---
  async probe(): Promise<DriverProbe> {
    let serverVersion = 'unknown';
    if (this.pool) {
      const res = await this.pool.query('SHOW server_version');
      serverVersion = String(res.rows[0]?.server_version ?? 'unknown');
    }
    return { serverVersion, verifiedCapabilities: this.enabledCapabilities() };
  }

  private enabledCapabilities(): DriverCapability[] {
    return (Object.keys(this.capabilities) as DriverCapability[]).filter(
      (c) => this.capabilities[c],
    );
  }

  async getSchemaVersion(): Promise<number | null> {
    try {
      const res = await this.execute(
        `SELECT MAX(${MigrationColumn.VERSION}) AS v FROM ${this.t(TableName.MIGRATION)}`,
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
      `INSERT INTO ${this.t(TableName.MIGRATION)} (${MigrationColumn.VERSION}, ${MigrationColumn.APPLIED_AT}, ${MigrationColumn.CHECKSUM}, ${MigrationColumn.CREATED_AT}, ${MigrationColumn.UPDATED_AT}) VALUES (${this.ph(0)}, ${this.ph(1)}, ${this.ph(2)}, ${this.ph(3)}, ${this.ph(4)})`,
      [migration.version, now, migration.checksum, now, now],
    );
  }

  async ensureBaseObjects(options: { context: DriverContext }): Promise<void> {
    this.context = options.context;
  }

  // --- Value conversion ---
  private toJson(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
  }
  private fromJson(value: unknown): unknown {
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
  private boolIn(value: boolean): number {
    return value ? 1 : 0;
  }
  private boolOut(value: unknown): boolean {
    return value === 1 || value === true || value === '1' || value === 't';
  }
  private numOrNull(value: unknown): number | null {
    return value == null ? null : Number(value);
  }
  private strOrNull(value: unknown): string | null {
    return value == null ? null : String(value);
  }

  /** Map + dedupe rows by a key, keeping the first occurrence (no unique index exists). */
  private mapUnique<T>(rows: Row[], map: (row: Row) => T, key: (item: T) => string): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const row of rows) {
      const item = map(row);
      const k = key(item);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  }

  private mapJob(row: Row): JobRecord {
    return {
      id: String(row[JobColumn.ID]),
      queueName: String(row[JobColumn.QUEUE_NAME]),
      status: row[JobColumn.STATUS] as JobStatus,
      priority: Number(row[JobColumn.PRIORITY]),
      data: this.fromJson(row[JobColumn.DATA]),
      returnValue: this.fromJson(row[JobColumn.RETURN_VALUE]),
      metadata: (this.fromJson(row[JobColumn.METADATA]) as Record<string, unknown>) ?? {},
      createdAt: Number(row[JobColumn.CREATED_AT]),
      updatedAt: Number(row[JobColumn.UPDATED_AT]),
      startAfter: Number(row[JobColumn.START_AFTER]),
      expireAt: this.numOrNull(row[JobColumn.EXPIRE_AT]),
      startedAt: this.numOrNull(row[JobColumn.STARTED_AT]),
      completedAt: this.numOrNull(row[JobColumn.COMPLETED_AT]),
      failedAt: this.numOrNull(row[JobColumn.FAILED_AT]),
      retriedAt: this.numOrNull(row[JobColumn.RETRIED_AT]),
      stalledAt: this.numOrNull(row[JobColumn.STALLED_AT]),
      cancelledAt: this.numOrNull(row[JobColumn.CANCELLED_AT]),
      expiredAt: this.numOrNull(row[JobColumn.EXPIRED_AT]),
      lockedUntil: this.numOrNull(row[JobColumn.LOCKED_UNTIL]),
      lockedByInstanceId: this.strOrNull(row[JobColumn.LOCKED_BY_INSTANCE_ID]),
      preferredInstanceKeyPattern: this.strOrNull(row[JobColumn.PREFERRED_INSTANCE_KEY_PATTERN]),
      processedOnInstanceKey: this.strOrNull(row[JobColumn.PROCESSED_ON_INSTANCE_KEY]),
      retryAttempt: Number(row[JobColumn.RETRY_ATTEMPT]),
      retryMaxAttempts: Number(row[JobColumn.RETRY_MAX_ATTEMPTS]),
      retryDelayMs: Number(row[JobColumn.RETRY_DELAY_MS]),
      retryBackoff: row[JobColumn.RETRY_BACKOFF] as BackoffStrategy,
      retryBackoffFactor: this.numOrNull(row[JobColumn.RETRY_BACKOFF_FACTOR]),
      retryMaxDelayMs: this.numOrNull(row[JobColumn.RETRY_MAX_DELAY_MS]),
      retryJitter: this.boolOut(row[JobColumn.RETRY_JITTER]),
      failureMessage: this.strOrNull(row[JobColumn.FAILURE_MESSAGE]),
      retentionMode: row[JobColumn.RETENTION_MODE] as RetentionMode,
      retentionTtlMs: this.numOrNull(row[JobColumn.RETENTION_TTL_MS]),
      idempotencyKey: this.strOrNull(row[JobColumn.IDEMPOTENCY_KEY]),
      scheduleId: this.strOrNull(row[JobColumn.SCHEDULE_ID]),
      singletonKey: this.strOrNull(row[JobColumn.SINGLETON_KEY]),
      workflowId: this.strOrNull(row[JobColumn.WORKFLOW_ID]),
      workflowStepKey: this.strOrNull(row[JobColumn.WORKFLOW_STEP_KEY]),
    };
  }

  private mapQueue(row: Row): QueueRow {
    return {
      name: String(row[QueueColumn.NAME]),
      processingPaused: this.boolOut(row[QueueColumn.PROCESSING_PAUSED]),
      acceptingPaused: this.boolOut(row[QueueColumn.ACCEPTING_PAUSED]),
      createdAt: Number(row[QueueColumn.CREATED_AT]),
      updatedAt: Number(row[QueueColumn.UPDATED_AT]),
    };
  }

  private mapInstance(row: Row): InstanceRow {
    return {
      instanceKey: String(row[InstanceColumn.INSTANCE_KEY]),
      processingPaused: this.boolOut(row[InstanceColumn.PROCESSING_PAUSED]),
      createdAt: Number(row[InstanceColumn.CREATED_AT]),
      updatedAt: Number(row[InstanceColumn.UPDATED_AT]),
      lastSeenAt: Number(row[InstanceColumn.LAST_SEEN_AT]),
    };
  }

  private mapSchedule(row: Row): ScheduleRow {
    return {
      id: String(row[ScheduleColumn.ID]),
      queueName: String(row[ScheduleColumn.QUEUE_NAME]),
      cron: this.strOrNull(row[ScheduleColumn.CRON]),
      everyMs: this.numOrNull(row[ScheduleColumn.EVERY_MS]),
      timezone: this.strOrNull(row[ScheduleColumn.TIMEZONE]),
      data: this.fromJson(row[ScheduleColumn.DATA]),
      priority: this.numOrNull(row[ScheduleColumn.PRIORITY]),
      retryMaxAttempts: this.numOrNull(row[ScheduleColumn.RETRY_MAX_ATTEMPTS]),
      retryDelayMs: this.numOrNull(row[ScheduleColumn.RETRY_DELAY_MS]),
      nextRunAt: this.numOrNull(row[ScheduleColumn.NEXT_RUN_AT]),
      lastRunAt: this.numOrNull(row[ScheduleColumn.LAST_RUN_AT]),
      enabled: this.boolOut(row[ScheduleColumn.ENABLED]),
      startAt: this.numOrNull(row[ScheduleColumn.START_AT]),
      endAt: this.numOrNull(row[ScheduleColumn.END_AT]),
      idempotencyKey: this.strOrNull(row[ScheduleColumn.IDEMPOTENCY_KEY]),
      createdAt: Number(row[ScheduleColumn.CREATED_AT]),
      updatedAt: Number(row[ScheduleColumn.UPDATED_AT]),
    };
  }

  // --- Producing ---
  private jobInsertValues(job: NewJobRecord): { columns: string[]; values: unknown[] } {
    const id = job.id ?? uuid();
    const now = job.createdAt;
    const columns = [...JOB_COLUMNS];
    const values: unknown[] = [
      id,
      job.queueName,
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
      job.preferredInstanceKeyPattern,
      null, // processed_on_instance_key (set at claim time)
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
    // No unique indexes exist (sharded-friendly schema): dedup is enforced here with a
    // pre-insert lookup. Best-effort across instances — accepted trade-off.
    if (job.idempotencyKey != null || job.singletonKey != null) {
      const existing = await this.findDeduplicated(job, tx);
      if (existing) return existing;
    }
    const { columns, values } = this.jobInsertValues(job);
    const placeholders = values.map((_, i) => this.ph(i)).join(', ');
    const sql = `INSERT INTO ${this.t(TableName.JOB)} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING ${JobColumn.ID}, ${JobColumn.STATUS}, ${JobColumn.START_AFTER}, ${JobColumn.WORKFLOW_ID}`;
    try {
      const res = await this.runMaybeTx(sql, values, tx);
      const row = res.rows[0]!;
      return {
        id: String(row[JobColumn.ID]),
        status: row[JobColumn.STATUS] as JobStatus,
        startAfter: Number(row[JobColumn.START_AFTER]),
        workflowId: this.strOrNull(row[JobColumn.WORKFLOW_ID]),
        deduplicated: false,
      };
    } catch (err) {
      throw new DriverQueryError(`Failed to insert job on queue '${job.queueName}'.`, err);
    }
  }

  /** Locate an existing job that dedups this insert on idempotency/singleton. */
  private async findDeduplicated(
    job: NewJobRecord,
    tx?: TransactionHandle,
  ): Promise<InsertedJobRow | null> {
    if (job.idempotencyKey != null) {
      const existing = await this.findJobByIdempotencyKey({
        queueName: job.queueName,
        idempotencyKey: job.idempotencyKey,
        ...(tx ? { tx } : {}),
      });
      if (existing) return existing;
    }
    if (job.singletonKey != null) {
      const res = await this.runMaybeTx(
        `SELECT ${JobColumn.ID}, ${JobColumn.STATUS}, ${JobColumn.START_AFTER}, ${JobColumn.WORKFLOW_ID} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.SINGLETON_KEY} = ${this.ph(1)} AND ${JobColumn.STATUS} IN ('${JobStatus.PENDING}','${JobStatus.ACTIVE}','${JobStatus.RETRY}')`,
        [job.queueName, job.singletonKey],
        tx,
      );
      if (res.rows[0]) {
        const row = res.rows[0];
        return {
          id: String(row[JobColumn.ID]),
          status: row[JobColumn.STATUS] as JobStatus,
          startAfter: Number(row[JobColumn.START_AFTER]),
          workflowId: this.strOrNull(row[JobColumn.WORKFLOW_ID]),
          deduplicated: true,
          deduplicationReason: DeduplicationReason.SINGLETON,
        };
      }
    }
    return null;
  }

  async findJobByIdempotencyKey(options: {
    queueName: string;
    idempotencyKey: string;
    tx?: TransactionHandle;
  }): Promise<InsertedJobRow | null> {
    const res = await this.runMaybeTx(
      `SELECT ${JobColumn.ID}, ${JobColumn.STATUS}, ${JobColumn.START_AFTER}, ${JobColumn.WORKFLOW_ID} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.IDEMPOTENCY_KEY} = ${this.ph(1)}`,
      [options.queueName, options.idempotencyKey],
      options.tx,
    );
    if (!res.rows[0]) return null;
    const row = res.rows[0];
    return {
      id: String(row[JobColumn.ID]),
      status: row[JobColumn.STATUS] as JobStatus,
      startAfter: Number(row[JobColumn.START_AFTER]),
      workflowId: this.strOrNull(row[JobColumn.WORKFLOW_ID]),
      deduplicated: true,
      deduplicationReason: DeduplicationReason.IDEMPOTENCY,
    };
  }

  async findScheduleByIdempotencyKey(options: {
    queueName: string;
    idempotencyKey: string;
    tx?: TransactionHandle;
  }): Promise<ScheduleRow | null> {
    const res = await this.runMaybeTx(
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} WHERE ${ScheduleColumn.QUEUE_NAME} = ${this.ph(0)} AND ${ScheduleColumn.IDEMPOTENCY_KEY} = ${this.ph(1)}`,
      [options.queueName, options.idempotencyKey],
      options.tx,
    );
    return res.rows[0] ? this.mapSchedule(res.rows[0]) : null;
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

  async insertSchedule(options: {
    schedule: NewScheduleRow;
    tx?: TransactionHandle;
  }): Promise<ScheduleRow> {
    const { schedule, tx } = options;
    const now = Date.now();
    // Plain INSERT — NOT an UPSERT and no pattern-based dedup. Identical recurrences on a queue are
    // allowed to coexist by design; the caller enforces idempotency-key dedup ahead of this call
    // (see ProducerService), so nothing here needs a conflict target that sharded engines reject.
    const id = schedule.id ?? uuid();
    const cols = [
      ScheduleColumn.ID,
      ScheduleColumn.QUEUE_NAME,
      ScheduleColumn.CRON,
      ScheduleColumn.EVERY_MS,
      ScheduleColumn.TIMEZONE,
      ScheduleColumn.DATA,
      ScheduleColumn.PRIORITY,
      ScheduleColumn.RETRY_MAX_ATTEMPTS,
      ScheduleColumn.RETRY_DELAY_MS,
      ScheduleColumn.NEXT_RUN_AT,
      ScheduleColumn.ENABLED,
      ScheduleColumn.START_AT,
      ScheduleColumn.END_AT,
      ScheduleColumn.IDEMPOTENCY_KEY,
      ScheduleColumn.CREATED_AT,
      ScheduleColumn.UPDATED_AT,
    ];
    const vals: unknown[] = [
      id,
      schedule.queueName,
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
      schedule.idempotencyKey,
      now,
      now,
    ];
    const placeholders = vals.map((_, i) => this.ph(i)).join(', ');
    const res = await this.runMaybeTx(
      `INSERT INTO ${this.t(TableName.SCHEDULE)} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      vals,
      tx,
    );
    return this.mapSchedule(res.rows[0]!);
  }

  async deleteSchedule(options: { scheduleId: string; tx?: TransactionHandle }): Promise<boolean> {
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.SCHEDULE)} WHERE ${ScheduleColumn.ID} = ${this.ph(0)}`,
      [options.scheduleId],
      options.tx,
    );
    return res.rowCount > 0;
  }

  // --- Claiming (hot path) ---
  async claimJobs(options: {
    queueName: string;
    limit: number;
    lockDurationMs: number;
    now: number;
    lockedByInstanceId: string;
    instanceKey?: string | null;
  }): Promise<JobRecord[]> {
    const { queueName, limit, lockDurationMs, now, lockedByInstanceId, instanceKey } = options;
    const lockedUntil = now + lockDurationMs;
    const cols = JOB_COLUMNS.join(', ');
    const skipLocked = this.capabilities[DriverCapability.SKIP_LOCKED]
      ? ' FOR UPDATE SKIP LOCKED'
      : '';

    // Single-instance mode: one guarded UPDATE ... RETURNING — atomic on both strategies.
    if (!instanceKey) {
      const build = (session?: Session) =>
        this.execute(
          `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.ACTIVE}', ${JobColumn.STARTED_AT} = ${this.ph(0)}, ${JobColumn.LOCKED_UNTIL} = ${this.ph(1)}, ` +
            `${JobColumn.LOCKED_BY_INSTANCE_ID} = ${this.ph(2)}, ${JobColumn.UPDATED_AT} = ${this.ph(3)} ` +
            `WHERE ${JobColumn.ID} IN (SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(4)} AND ${JobColumn.STATUS} IN ('${JobStatus.PENDING}','${JobStatus.RETRY}') ` +
            `AND ${JobColumn.START_AFTER} <= ${this.ph(5)} AND (${JobColumn.EXPIRE_AT} IS NULL OR ${JobColumn.EXPIRE_AT} > ${this.ph(6)}) ` +
            `ORDER BY ${JobColumn.PRIORITY} DESC, ${JobColumn.START_AFTER} ASC LIMIT ${this.ph(7)}${skipLocked}) RETURNING ${cols}`,
          [now, lockedUntil, lockedByInstanceId, now, queueName, now, now, limit],
          session,
        );
      const res = this.capabilities[DriverCapability.SKIP_LOCKED]
        ? await this.transaction((session) => build(session))
        : await build();
      return res.rows
        .map((r) => this.mapJob(r))
        .sort((a, b) => b.priority - a.priority || a.startAfter - b.startAfter);
    }

    // Multi-instance mode: affinity (a preferred key pattern) can't be expressed in portable SQL,
    // so page through candidates highest-priority-first, keep only those this instance's key
    // matches, and stop as soon as the batch is full or a page comes back short (no more work).
    // Paging — rather than one capped window — prevents starvation: when the top rows all target
    // other instances, the jobs this instance *can* run may sit past the first page. Scanning
    // holds no locks (candidates are PENDING/RETRY, never locked), so a shifting result set only
    // costs a missed row this tick (the poll/NOTIFY retries); the guarded UPDATE below is the
    // atomic claim, and a lost race just returns fewer rows.
    const pageSize = Math.min(Math.max(limit * 5, limit + 20), 500);
    // Bound the scan so a backlog of exclusively-non-matching jobs can't turn one tick into a
    // full-table sweep; the next tick resumes from the top.
    const maxScan = Math.max(pageSize * 20, 2000);
    const idSet = new Set<string>();
    for (let offset = 0; idSet.size < limit && offset < maxScan; offset += pageSize) {
      const sel = await this.execute(
        `SELECT ${JobColumn.ID}, ${JobColumn.PREFERRED_INSTANCE_KEY_PATTERN} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.STATUS} IN ('${JobStatus.PENDING}','${JobStatus.RETRY}') ` +
          `AND ${JobColumn.START_AFTER} <= ${this.ph(1)} AND (${JobColumn.EXPIRE_AT} IS NULL OR ${JobColumn.EXPIRE_AT} > ${this.ph(2)}) ` +
          `ORDER BY ${JobColumn.PRIORITY} DESC, ${JobColumn.START_AFTER} ASC LIMIT ${this.ph(3)} OFFSET ${this.ph(4)}`,
        [queueName, now, now, pageSize, offset],
      );
      if (sel.rows.length === 0) break; // exhausted — nothing more to scan
      for (const row of sel.rows) {
        if (matchesInstance(this.strOrNull(row[JobColumn.PREFERRED_INSTANCE_KEY_PATTERN]), instanceKey)) {
          idSet.add(String(row[JobColumn.ID]));
          if (idSet.size >= limit) break;
        }
      }
      if (sel.rows.length < pageSize) break; // last (partial) page
    }
    if (idSet.size === 0) return [];
    const ids = [...idSet];
    return this.transaction(async (session) => {
      const setParams = [now, lockedUntil, lockedByInstanceId, instanceKey, now];
      const idPh = ids.map((_, i) => this.ph(setParams.length + i)).join(', ');
      const upd = await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.ACTIVE}', ${JobColumn.STARTED_AT} = ${this.ph(0)}, ${JobColumn.LOCKED_UNTIL} = ${this.ph(1)}, ` +
          `${JobColumn.LOCKED_BY_INSTANCE_ID} = ${this.ph(2)}, ${JobColumn.PROCESSED_ON_INSTANCE_KEY} = ${this.ph(3)}, ${JobColumn.UPDATED_AT} = ${this.ph(4)} ` +
          `WHERE ${JobColumn.ID} IN (${idPh}) AND ${JobColumn.STATUS} IN ('${JobStatus.PENDING}','${JobStatus.RETRY}') RETURNING ${cols}`,
        [...setParams, ...ids],
        session,
      );
      return upd.rows
        .map((r) => this.mapJob(r))
        .sort((a, b) => b.priority - a.priority || a.startAfter - b.startAfter);
    });
  }

  async extendLock(options: {
    jobId: string;
    lockDurationMs: number;
    now: number;
  }): Promise<boolean> {
    const res = await this.execute(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.LOCKED_UNTIL} = ${this.ph(0)}, ${JobColumn.UPDATED_AT} = ${this.ph(1)} WHERE ${JobColumn.ID} = ${this.ph(2)} AND ${JobColumn.STATUS} = '${JobStatus.ACTIVE}'`,
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
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.COMPLETED}', ${JobColumn.RETURN_VALUE} = ${this.ph(0)}, ${JobColumn.COMPLETED_AT} = ${this.ph(1)}, ${JobColumn.UPDATED_AT} = ${this.ph(2)}, ${JobColumn.LOCKED_UNTIL} = NULL WHERE ${JobColumn.ID} = ${this.ph(3)}`,
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
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.RETRY}', ${JobColumn.RETRY_ATTEMPT} = ${this.ph(0)}, ${JobColumn.START_AFTER} = ${this.ph(1)}, ${JobColumn.RETRIED_AT} = ${this.ph(2)}, ${JobColumn.FAILURE_MESSAGE} = ${this.ph(3)}, ${JobColumn.UPDATED_AT} = ${this.ph(4)}, ${JobColumn.LOCKED_UNTIL} = NULL WHERE ${JobColumn.ID} = ${this.ph(5)}`,
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
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.FAILED}', ${JobColumn.FAILED_AT} = ${this.ph(0)}, ${JobColumn.FAILURE_MESSAGE} = ${this.ph(1)}, ${JobColumn.UPDATED_AT} = ${this.ph(2)}, ${JobColumn.LOCKED_UNTIL} = NULL WHERE ${JobColumn.ID} = ${this.ph(3)}`,
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
    // Complete-this + spawn-next in ONE transaction.
    return this.transaction(async (session) => {
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.COMPLETED}', ${JobColumn.RETURN_VALUE} = ${this.ph(0)}, ${JobColumn.COMPLETED_AT} = ${this.ph(1)}, ${JobColumn.UPDATED_AT} = ${this.ph(2)}, ${JobColumn.LOCKED_UNTIL} = NULL WHERE ${JobColumn.ID} = ${this.ph(3)}`,
        [this.toJson(options.returnValue), options.now, options.now, options.jobId],
        session,
      );
      if (!options.spawn) return null;
      const { columns, values } = this.jobInsertValues(options.spawn);
      const placeholders = values.map((_, i) => this.ph(i)).join(', ');
      const res = await this.execute(
        `INSERT INTO ${this.t(TableName.JOB)} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING ${JobColumn.ID}, ${JobColumn.STATUS}, ${JobColumn.START_AFTER}, ${JobColumn.WORKFLOW_ID}`,
        values,
        session,
      );
      const row = res.rows[0]!;
      return {
        id: String(row[JobColumn.ID]),
        status: row[JobColumn.STATUS] as JobStatus,
        startAfter: Number(row[JobColumn.START_AFTER]),
        workflowId: this.strOrNull(row[JobColumn.WORKFLOW_ID]),
        deduplicated: false,
      };
    });
  }

  async reclaimStalledJobs(options: { queueName?: string; now: number }): Promise<JobRecord[]> {
    const cols = JOB_COLUMNS.join(', ');
    const params: unknown[] = [options.now, options.now];
    let where = `${JobColumn.STATUS} = '${JobStatus.ACTIVE}' AND ${JobColumn.LOCKED_UNTIL} IS NOT NULL AND ${JobColumn.LOCKED_UNTIL} < ${this.ph(1)}`;
    if (options.queueName) {
      where += ` AND ${JobColumn.QUEUE_NAME} = ${this.ph(2)}`;
      params.push(options.queueName);
    }
    // Return stalled jobs to PENDING (RETRY handling happens in the completion path on next fail).
    const res = await this.execute(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.PENDING}', ${JobColumn.STALLED_AT} = ${this.ph(0)}, ${JobColumn.LOCKED_UNTIL} = NULL, ${JobColumn.LOCKED_BY_INSTANCE_ID} = NULL WHERE ${where} RETURNING ${cols}`,
      params,
    );
    return res.rows.map((r) => this.mapJob(r));
  }

  async expireDueJobs(options: { queueName?: string; now: number }): Promise<JobRecord[]> {
    const cols = JOB_COLUMNS.join(', ');
    const params: unknown[] = [options.now, options.now, options.now];
    let where = `${JobColumn.STATUS} IN ('${JobStatus.PENDING}','${JobStatus.RETRY}') AND ${JobColumn.EXPIRE_AT} IS NOT NULL AND ${JobColumn.EXPIRE_AT} <= ${this.ph(2)}`;
    if (options.queueName) {
      where += ` AND ${JobColumn.QUEUE_NAME} = ${this.ph(3)}`;
      params.push(options.queueName);
    }
    const res = await this.execute(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.EXPIRED}', ${JobColumn.EXPIRED_AT} = ${this.ph(0)}, ${JobColumn.UPDATED_AT} = ${this.ph(1)}, ${JobColumn.LOCKED_UNTIL} = NULL WHERE ${where} RETURNING ${cols}`,
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
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.PENDING}', ${JobColumn.RETRY_ATTEMPT} = 0, ${JobColumn.START_AFTER} = ${this.ph(0)}, ` +
          `${JobColumn.FAILED_AT} = NULL, ${JobColumn.FAILURE_MESSAGE} = NULL, ${JobColumn.COMPLETED_AT} = NULL, ${JobColumn.STARTED_AT} = NULL, ${JobColumn.CANCELLED_AT} = NULL, ${JobColumn.EXPIRED_AT} = NULL, ` +
          `${JobColumn.LOCKED_UNTIL} = NULL, ${JobColumn.LOCKED_BY_INSTANCE_ID} = NULL, ${JobColumn.UPDATED_AT} = ${this.ph(1)} WHERE ${JobColumn.ID} = ${this.ph(2)}`,
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
        `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.WORKFLOW_ID} = ${this.ph(0)} ORDER BY ${JobColumn.CREATED_AT} ASC LIMIT 1`,
        [job.workflowId],
      );
      if (entry.rows[0]) seed = this.mapJob(entry.rows[0]);
    }
    const newWorkflowId = job.workflowId ? (options.newWorkflowId ?? uuid()) : null;
    const fresh: NewJobRecord = {
      queueName: seed.queueName,
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
      preferredInstanceKeyPattern: seed.preferredInstanceKeyPattern,
      createdAt: options.now,
    };
    return this.insertJob({ job: fresh });
  }

  // --- Reading ---
  async getJob(options: { jobId: string }): Promise<JobRecord | null> {
    const res = await this.execute(
      `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} = ${this.ph(0)}`,
      [options.jobId],
    );
    return res.rows[0] ? this.mapJob(res.rows[0]) : null;
  }

  async getJobs(options: {
    queueName?: string;
    statuses?: JobStatus[];
    scheduleId?: string;
    workflowId?: string;
    processedOnInstanceKey?: string;
    limit: number;
    offset: number;
    order: 'asc' | 'desc';
  }): Promise<JobRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.queueName) {
      clauses.push(`${JobColumn.QUEUE_NAME} = ${this.ph(params.length)}`);
      params.push(options.queueName);
    }
    if (options.statuses && options.statuses.length) {
      const ph = options.statuses.map((_, i) => this.ph(params.length + i)).join(', ');
      clauses.push(`${JobColumn.STATUS} IN (${ph})`);
      params.push(...options.statuses);
    }
    if (options.scheduleId) {
      clauses.push(`${JobColumn.SCHEDULE_ID} = ${this.ph(params.length)}`);
      params.push(options.scheduleId);
    }
    if (options.workflowId) {
      clauses.push(`${JobColumn.WORKFLOW_ID} = ${this.ph(params.length)}`);
      params.push(options.workflowId);
    }
    if (options.processedOnInstanceKey) {
      clauses.push(`${JobColumn.PROCESSED_ON_INSTANCE_KEY} = ${this.ph(params.length)}`);
      params.push(options.processedOnInstanceKey);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limitPh = this.ph(params.length);
    params.push(options.limit);
    const offsetPh = this.ph(params.length);
    params.push(options.offset);
    const res = await this.execute(
      `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} ${where} ORDER BY ${JobColumn.CREATED_AT} ${options.order === 'asc' ? 'ASC' : 'DESC'} LIMIT ${limitPh} OFFSET ${offsetPh}`,
      params,
    );
    return res.rows.map((r) => this.mapJob(r));
  }

  async countJobsByStatus(options: {
    queueName?: string;
    processedOnInstanceKey?: string;
  }): Promise<Record<JobStatus, number>> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.queueName) {
      clauses.push(`${JobColumn.QUEUE_NAME} = ${this.ph(params.length)}`);
      params.push(options.queueName);
    }
    if (options.processedOnInstanceKey) {
      clauses.push(`${JobColumn.PROCESSED_ON_INSTANCE_KEY} = ${this.ph(params.length)}`);
      params.push(options.processedOnInstanceKey);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const res = await this.execute(
      `SELECT ${JobColumn.STATUS}, COUNT(*) AS c FROM ${this.t(TableName.JOB)} ${where} GROUP BY ${JobColumn.STATUS}`,
      params,
    );
    const counts = emptyStatusCounts();
    for (const row of res.rows) {
      counts[row[JobColumn.STATUS] as JobStatus] = Number(row.c);
    }
    return counts;
  }

  async listQueues(): Promise<QueueRow[]> {
    const res = await this.execute(`SELECT * FROM ${this.t(TableName.QUEUE)} ORDER BY ${QueueColumn.NAME} ASC`, []);
    // No unique index on name: dedupe defensively so a creation race can't surface twice.
    return this.mapUnique(res.rows, (r) => this.mapQueue(r), (q) => q.name);
  }

  async listSchedules(options: { queueName?: string }): Promise<ScheduleRow[]> {
    const params: unknown[] = [];
    let where = '';
    if (options.queueName) {
      where = `WHERE ${ScheduleColumn.QUEUE_NAME} = ${this.ph(0)}`;
      params.push(options.queueName);
    }
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} ${where} ORDER BY ${ScheduleColumn.CREATED_AT} ASC`,
      params,
    );
    return res.rows.map((r) => this.mapSchedule(r));
  }

  async getSchedule(options: { scheduleId: string }): Promise<ScheduleRow | null> {
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} WHERE ${ScheduleColumn.ID} = ${this.ph(0)}`,
      [options.scheduleId],
    );
    return res.rows[0] ? this.mapSchedule(res.rows[0]) : null;
  }

  async getThroughput(options: {
    queueName?: string;
    sinceMs: number;
    now: number;
  }): Promise<ThroughputPoint[]> {
    const params: unknown[] = [options.sinceMs];
    let where = `(${JobColumn.COMPLETED_AT} IS NOT NULL OR ${JobColumn.FAILED_AT} IS NOT NULL) AND ${JobColumn.UPDATED_AT} >= ${this.ph(0)}`;
    if (options.queueName) {
      where += ` AND ${JobColumn.QUEUE_NAME} = ${this.ph(1)}`;
      params.push(options.queueName);
    }
    const res = await this.execute(
      `SELECT ${JobColumn.STATUS}, ${JobColumn.COMPLETED_AT}, ${JobColumn.FAILED_AT} FROM ${this.t(TableName.JOB)} WHERE ${where}`,
      params,
    );
    // Bucket by minute in-memory (avoids engine-specific date functions).
    const buckets = new Map<number, ThroughputPoint>();
    for (const row of res.rows) {
      const ts = row[JobColumn.COMPLETED_AT] != null ? Number(row[JobColumn.COMPLETED_AT]) : Number(row[JobColumn.FAILED_AT]);
      const bucket = Math.floor(ts / 60000) * 60000;
      const point = buckets.get(bucket) ?? { bucketStart: bucket, completed: 0, failed: 0 };
      if (row[JobColumn.STATUS] === JobStatus.COMPLETED) point.completed += 1;
      else if (row[JobColumn.STATUS] === JobStatus.FAILED) point.failed += 1;
      buckets.set(bucket, point);
    }
    return [...buckets.values()].sort((a, b) => a.bucketStart - b.bucketStart);
  }

  async getDueSchedules(options: { now: number; limit: number }): Promise<ScheduleRow[]> {
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} WHERE ${ScheduleColumn.ENABLED} = 1 AND ${ScheduleColumn.NEXT_RUN_AT} IS NOT NULL AND ${ScheduleColumn.NEXT_RUN_AT} <= ${this.ph(0)} ORDER BY ${ScheduleColumn.NEXT_RUN_AT} ASC LIMIT ${this.ph(1)}`,
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
      `UPDATE ${this.t(TableName.SCHEDULE)} SET ${ScheduleColumn.NEXT_RUN_AT} = ${this.ph(0)}, ${ScheduleColumn.LAST_RUN_AT} = ${this.ph(1)}, ${ScheduleColumn.UPDATED_AT} = ${this.ph(2)} WHERE ${ScheduleColumn.ID} = ${this.ph(3)} AND ${ScheduleColumn.NEXT_RUN_AT} = ${this.ph(4)}`,
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
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.CANCELLED}', ${JobColumn.CANCELLED_AT} = ${this.ph(0)}, ${JobColumn.UPDATED_AT} = ${this.ph(1)} WHERE ${JobColumn.ID} = ${this.ph(2)} AND ${JobColumn.STATUS} IN ('${JobStatus.PENDING}','${JobStatus.RETRY}')`,
      [options.now, options.now, options.jobId],
    );
    return res.rowCount > 0;
  }

  async removeJob(options: { jobId: string; tx?: TransactionHandle }): Promise<boolean> {
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} = ${this.ph(0)}`,
      [options.jobId],
      options.tx,
    );
    return res.rowCount > 0;
  }

  async removeJobsByIds(options: { jobIds: string[]; queueName: string }): Promise<number> {
    if (!options.jobIds.length) return 0;
    const idPh = options.jobIds.map((_, i) => this.ph(i)).join(', ');
    // Placeholder appearance order (IN list, then queue_name) must match the params array
    // so positional-bind engines (SQLite '?') and indexed engines ('$n') both work.
    const res = await this.execute(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} IN (${idPh}) AND ${JobColumn.QUEUE_NAME} = ${this.ph(options.jobIds.length)}`,
      [...options.jobIds, options.queueName],
    );
    return res.rowCount;
  }

  async removeJobsByStatus(options: { queueName: string; statuses: JobStatus[] }): Promise<number> {
    if (!options.statuses.length) return 0;
    const statusPh = options.statuses.map((_, i) => this.ph(i)).join(', ');
    const res = await this.execute(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.STATUS} IN (${statusPh}) AND ${JobColumn.QUEUE_NAME} = ${this.ph(options.statuses.length)}`,
      [...options.statuses, options.queueName],
    );
    return res.rowCount;
  }

  // --- Queue control ---
  async setQueuePaused(options: {
    queueName: string;
    processingPaused?: boolean;
    acceptingPaused?: boolean;
    now: number;
    tx?: TransactionHandle;
  }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (options.processingPaused !== undefined) {
      sets.push(`${QueueColumn.PROCESSING_PAUSED} = ${this.ph(params.length)}`);
      params.push(this.boolIn(options.processingPaused));
    }
    if (options.acceptingPaused !== undefined) {
      sets.push(`${QueueColumn.ACCEPTING_PAUSED} = ${this.ph(params.length)}`);
      params.push(this.boolIn(options.acceptingPaused));
    }
    sets.push(`${QueueColumn.UPDATED_AT} = ${this.ph(params.length)}`);
    params.push(options.now);
    params.push(options.queueName);
    await this.runMaybeTx(
      `UPDATE ${this.t(TableName.QUEUE)} SET ${sets.join(', ')} WHERE ${QueueColumn.NAME} = ${this.ph(params.length - 1)}`,
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
    // Get-or-create, not an UPSERT: a queue is created once then only read, so a plain
    // SELECT-then-INSERT is enough and avoids `ON CONFLICT`/`MERGE` (which sharded engines reject
    // without the shard key). No unique index on name; a rare creation race can leave two rows,
    // and listQueues/getQueueByName dedupe by name so callers never see both.
    await this.runMaybeTx(
      `INSERT INTO ${this.t(TableName.QUEUE)} (${QueueColumn.NAME}, ${QueueColumn.PROCESSING_PAUSED}, ${QueueColumn.ACCEPTING_PAUSED}, ${QueueColumn.CREATED_AT}, ${QueueColumn.UPDATED_AT}) VALUES (${this.ph(0)}, 0, 0, ${this.ph(1)}, ${this.ph(2)})`,
      [options.name, options.now, options.now],
      options.tx,
    );
    const row = await this.getQueueByName({ name: options.name });
    if (!row) throw new DriverQueryError(`Failed to ensure queue '${options.name}'.`);
    return row;
  }

  async getQueueByName(options: { name: string }): Promise<QueueRow | null> {
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.QUEUE)} WHERE ${QueueColumn.NAME} = ${this.ph(0)}`,
      [options.name],
    );
    return res.rows[0] ? this.mapQueue(res.rows[0]) : null;
  }

  async deleteQueue(options: { name: string; tx?: TransactionHandle }): Promise<boolean> {
    // Only removes the queue row. Jobs link by queue_name (no FK/PK), so this never cascades —
    // any leftover job rows keep their name and are unaffected; the caller guards "not in use".
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.QUEUE)} WHERE ${QueueColumn.NAME} = ${this.ph(0)}`,
      [options.name],
      options.tx,
    );
    return res.rowCount > 0;
  }

  // --- Instance liveness & per-instance pause ---
  async upsertInstance(options: { instanceKey: string; now: number }): Promise<InstanceRow> {
    // Update-first, then insert if absent — NOT a database UPSERT (`ON CONFLICT`/`MERGE`), which
    // sharded engines reject unless the conflict target is the shard key. The heartbeat's common
    // case is "row exists", so the guarded UPDATE ... RETURNING resolves it in one round-trip and
    // never touches the (independently controlled) pause flag; only the first beat falls through
    // to INSERT. A rare create race can leave two rows; listInstances dedupes by key.
    const updated = await this.execute(
      `UPDATE ${this.t(TableName.INSTANCE)} SET ${InstanceColumn.LAST_SEEN_AT} = ${this.ph(0)}, ${InstanceColumn.UPDATED_AT} = ${this.ph(1)} WHERE ${InstanceColumn.INSTANCE_KEY} = ${this.ph(2)} RETURNING *`,
      [options.now, options.now, options.instanceKey],
    );
    if (updated.rows[0]) return this.mapInstance(updated.rows[0]);
    const inserted = await this.execute(
      `INSERT INTO ${this.t(TableName.INSTANCE)} (${InstanceColumn.INSTANCE_KEY}, ${InstanceColumn.PROCESSING_PAUSED}, ${InstanceColumn.CREATED_AT}, ${InstanceColumn.UPDATED_AT}, ${InstanceColumn.LAST_SEEN_AT}) VALUES (${this.ph(0)}, 0, ${this.ph(1)}, ${this.ph(2)}, ${this.ph(3)}) RETURNING *`,
      [options.instanceKey, options.now, options.now, options.now],
    );
    return this.mapInstance(inserted.rows[0]!);
  }

  async listInstances(): Promise<InstanceRow[]> {
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.INSTANCE)} ORDER BY ${InstanceColumn.INSTANCE_KEY} ASC`,
      [],
    );
    return this.mapUnique(res.rows, (r) => this.mapInstance(r), (i) => i.instanceKey);
  }

  async getInstance(options: { instanceKey: string }): Promise<InstanceRow | null> {
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.INSTANCE)} WHERE ${InstanceColumn.INSTANCE_KEY} = ${this.ph(0)}`,
      [options.instanceKey],
    );
    return res.rows[0] ? this.mapInstance(res.rows[0]) : null;
  }

  async setInstancePaused(options: {
    instanceKey: string;
    processingPaused: boolean;
    now: number;
  }): Promise<void> {
    await this.execute(
      `UPDATE ${this.t(TableName.INSTANCE)} SET ${InstanceColumn.PROCESSING_PAUSED} = ${this.ph(0)}, ${InstanceColumn.UPDATED_AT} = ${this.ph(1)} WHERE ${InstanceColumn.INSTANCE_KEY} = ${this.ph(2)}`,
      [this.boolIn(options.processingPaused), options.now, options.instanceKey],
    );
  }

  async deleteInstance(options: {
    instanceKey: string;
    tx?: TransactionHandle;
  }): Promise<boolean> {
    // Only removes the instance (monitoring) row. Jobs record processed_on_instance_key as a plain
    // string (no FK/PK), so removing an instance never touches or orphans any job rows.
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.INSTANCE)} WHERE ${InstanceColumn.INSTANCE_KEY} = ${this.ph(0)}`,
      [options.instanceKey],
      options.tx,
    );
    return res.rowCount > 0;
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
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} IN (SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.STATUS} IN (${statusPh}) ` +
        `AND ${JobColumn.RETENTION_MODE} = 'DELETE_AFTER' AND ${JobColumn.RETENTION_TTL_MS} IS NOT NULL ` +
        `AND (COALESCE(${JobColumn.COMPLETED_AT}, ${JobColumn.FAILED_AT}, ${JobColumn.CANCELLED_AT}, ${JobColumn.EXPIRED_AT}, ${JobColumn.UPDATED_AT}) + ${JobColumn.RETENTION_TTL_MS}) <= ${cutoffPh} LIMIT ${limitPh})`,
      [...options.statuses, options.olderThan, options.limit],
    );
    return res.rowCount;
  }

  // --- Pub/sub (unsupported: YSQL has no LISTEN/NOTIFY; the safety poll backstops it) ---
  async notify(_options: { channel: string; payload: string }): Promise<void> {
    // No-op — Yugabyte does not implement LISTEN/NOTIFY.
  }

  async subscribe(_options: {
    channel: string;
    onNotification: (payload: string) => void;
  }): Promise<Subscription> {
    throw new UnsupportedCapabilityError(
      DriverCapability.LISTEN_NOTIFY,
      'Yugabyte (YSQL) has no LISTEN/NOTIFY; PortQueue uses interval polling instead. Core should not call subscribe() without the LISTEN_NOTIFY capability.',
    );
  }

  // --- Advisory locks ---
  async tryAdvisoryLock(options: { key: string }): Promise<boolean> {
    if (!this.pool) return false;
    const n = advisoryKey(options.key);
    const res = await this.pool.query('SELECT pg_try_advisory_lock($1) AS locked', [n]);
    return res.rows[0]?.locked === true;
  }

  async releaseAdvisoryLock(options: { key: string }): Promise<void> {
    if (!this.pool) return;
    await this.pool.query('SELECT pg_advisory_unlock($1)', [advisoryKey(options.key)]);
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

/** Map a string key to a 63-bit advisory-lock integer. */
function advisoryKey(key: string): number {
  const hash = createHash('sha1').update(key).digest();
  // Use 6 bytes to stay within a safe JS integer.
  return hash.readUIntBE(0, 6);
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
