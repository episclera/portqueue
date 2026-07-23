import {
  DatabaseEngine,
  DeduplicationReason,
  RetentionMode,
  BackoffStrategy,
} from '../../options/enums.js';
import { JobStatus } from '../../jobs/job-state.enum.js';
import {
  capabilities,
  DriverCapability,
  type DriverCapabilitySet,
} from '../driver-capabilities.js';
import {
  DriverConnectionError,
  DriverQueryError,
  MissingPeerDependencyError,
  UnsupportedCapabilityError,
} from '../../errors/errors.js';
import { TableName } from '../table-names.js';
import { matchesInstance } from '../../jobs/instance-affinity.js';
import { uuid } from '../../util/uuid.js';
import { toMigrationSteps } from '../shared/migration.js';
import { MYSQL_MIGRATIONS } from './migrations.js';
import type {
  Driver,
  DriverProbe,
  MigrationStep,
  RequeueFrom,
  Subscription,
  WorkflowNext,
} from '../driver.interface.js';
import type { DriverContext } from '../driver-context.js';
import type {
  InsertedJobRow,
  InstanceRow,
  JobRecord,
  NewJobRecord,
  NewScheduleRow,
  QueueRow,
  ScheduleRow,
  ThroughputPoint,
} from '../../jobs/job-record.js';
import type { QueueOptions } from '../../options/queue-options.js';
import type { TransactionHandle, TxQueryResult } from '../../tx/transaction-handle.js';

export interface MysqlDriverOptions {
  /** A `mysql://…` connection URI. */
  connectionString?: string;
  /** An existing `mysql2` pool to share with the app. */
  pool?: unknown;
  /** Any `mysql2` pool config (host/user/password/database/…). */
  config?: Record<string, unknown>;
}

interface MysqlOkPacket {
  affectedRows?: number;
  insertId?: number;
}
interface MysqlConnection {
  query(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}
interface MysqlPool {
  query(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]>;
  getConnection(): Promise<MysqlConnection>;
  end(): Promise<void>;
}

/** A raw query result. */
interface RawResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}
/** An opaque per-connection session used inside a transaction. */
type Session = MysqlConnection | undefined;
type Row = Record<string, unknown>;

const JOB_COLUMNS = [
  'id',
  'queue_name',
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
  'preferred_instance_key_pattern',
  'processed_on_instance_key',
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
 * MySQL driver — standalone, owning its entire SQL surface (no shared base). MySQL speaks `?`
 * positional placeholders and supports SKIP LOCKED (8.0+) and transactions, but — unlike every
 * other engine here — it has NO `RETURNING`. So every "mutate and read back" operation is written
 * as an explicit two-step: the app supplies the id (or the guarded UPDATE targets known ids), then
 * a follow-up `SELECT` reads the affected rows. No LISTEN/NOTIFY and no advisory lock; the polling
 * backstop drives wakeups. No method emits a relational JOIN — relationships resolve by name/key
 * lookups, and the schema carries no unique index, so name-uniqueness and idempotency/singleton
 * dedup are enforced here in code. `mysql2` is an optional peer dependency.
 */
export class MysqlDriver implements Driver {
  readonly engine = DatabaseEngine.MYSQL;
  readonly capabilities: DriverCapabilitySet = capabilities({
    [DriverCapability.SKIP_LOCKED]: true,
    [DriverCapability.TRANSACTIONS]: true,
    // No RETURNING, no LISTEN/NOTIFY, no advisory lock.
  });
  readonly migrations = toMigrationSteps(MYSQL_MIGRATIONS);

  protected context!: DriverContext;
  private pool: MysqlPool | null = null;
  private readonly options: MysqlDriverOptions;

  constructor(options: MysqlDriverOptions = {}) {
    this.options = options;
  }

  setContext(context: DriverContext): void {
    this.context = context;
  }

  // --- Connection management ---
  async connect(): Promise<void> {
    if (this.options.pool) {
      this.pool = this.options.pool as MysqlPool;
      return;
    }
    let mysql: { createPool(config: unknown): MysqlPool };
    try {
      const mod = (await import('mysql2/promise' as string)) as {
        default?: { createPool(config: unknown): MysqlPool };
        createPool?: (config: unknown) => MysqlPool;
      };
      mysql = (mod.default ?? mod) as { createPool(config: unknown): MysqlPool };
    } catch {
      throw new MissingPeerDependencyError('mysql2', 'MySQL');
    }
    try {
      const config: Record<string, unknown> = { ...this.options.config };
      if (this.options.connectionString) config.uri = this.options.connectionString;
      this.pool = mysql.createPool(config);
      await this.pool.query('SELECT 1', []);
    } catch (err) {
      throw new DriverConnectionError('Failed to connect to MySQL.', err);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool && !this.options.pool) await this.pool.end();
    this.pool = null;
  }

  private toRaw(result: unknown): RawResult {
    if (Array.isArray(result)) {
      const rows = result as Array<Record<string, unknown>>;
      return { rows, rowCount: rows.length };
    }
    const ok = (result ?? {}) as MysqlOkPacket;
    return { rows: [], rowCount: ok.affectedRows ?? 0 };
  }

  private async execute(
    sql: string,
    params: readonly unknown[],
    session?: Session,
  ): Promise<RawResult> {
    const target = session ?? this.pool;
    if (!target) throw new DriverConnectionError('MySQL driver is not connected.');
    const [result] = await target.query(sql, params);
    return this.toRaw(result);
  }

  private async transaction<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    if (!this.pool) throw new DriverConnectionError('MySQL driver is not connected.');
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      throw err;
    } finally {
      conn.release();
    }
  }

  // --- Naming helpers ---
  private t(table: TableName): string {
    return this.context.tableNames.bare(table);
  }
  /** MySQL uses `?` positional placeholders. */
  private ph(_index0: number): string {
    return '?';
  }

  // --- Probe / migration ---
  async probe(): Promise<DriverProbe> {
    let serverVersion = 'unknown';
    if (this.pool) {
      const res = await this.execute('SELECT VERSION() AS v', []);
      serverVersion = String(res.rows[0]?.v ?? 'unknown');
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
        `SELECT MAX(version) AS v FROM ${this.t(TableName.MIGRATION)}`,
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
      `INSERT INTO ${this.t(TableName.MIGRATION)} (version, applied_at, checksum, created_at, updated_at) VALUES (${this.ph(0)}, ${this.ph(1)}, ${this.ph(2)}, ${this.ph(3)}, ${this.ph(4)})`,
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
      id: String(row.id),
      queueName: String(row.queue_name),
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
      lockedByInstanceId: this.strOrNull(row.locked_by_instance_id),
      preferredInstanceKeyPattern: this.strOrNull(row.preferred_instance_key_pattern),
      processedOnInstanceKey: this.strOrNull(row.processed_on_instance_key),
      retryAttempt: Number(row.retry_attempt),
      retryMaxAttempts: Number(row.retry_max_attempts),
      retryDelayMs: Number(row.retry_delay_ms),
      retryBackoff: row.retry_backoff as BackoffStrategy,
      retryBackoffFactor: this.numOrNull(row.retry_backoff_factor),
      retryMaxDelayMs: this.numOrNull(row.retry_max_delay_ms),
      retryJitter: this.boolOut(row.retry_jitter),
      failureMessage: this.strOrNull(row.failure_message),
      retentionMode: row.retention_mode as RetentionMode,
      retentionTtlMs: this.numOrNull(row.retention_ttl_ms),
      idempotencyKey: this.strOrNull(row.idempotency_key),
      scheduleId: this.strOrNull(row.schedule_id),
      singletonKey: this.strOrNull(row.singleton_key),
      workflowId: this.strOrNull(row.workflow_id),
      workflowStepKey: this.strOrNull(row.workflow_step_key),
    };
  }

  private mapQueue(row: Row): QueueRow {
    return {
      name: String(row.name),
      processingPaused: this.boolOut(row.processing_paused),
      acceptingPaused: this.boolOut(row.accepting_paused),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private mapInstance(row: Row): InstanceRow {
    return {
      instanceKey: String(row.instance_key),
      processingPaused: this.boolOut(row.processing_paused),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      lastSeenAt: Number(row.last_seen_at),
    };
  }

  private mapSchedule(row: Row): ScheduleRow {
    return {
      id: String(row.id),
      queueName: String(row.queue_name),
      cron: this.strOrNull(row.cron),
      everyMs: this.numOrNull(row.every_ms),
      timezone: this.strOrNull(row.timezone),
      data: this.fromJson(row.data),
      priority: this.numOrNull(row.priority),
      retryMaxAttempts: this.numOrNull(row.retry_max_attempts),
      retryDelayMs: this.numOrNull(row.retry_delay_ms),
      nextRunAt: this.numOrNull(row.next_run_at),
      lastRunAt: this.numOrNull(row.last_run_at),
      enabled: this.boolOut(row.enabled),
      startAt: this.numOrNull(row.start_at),
      endAt: this.numOrNull(row.end_at),
      idempotencyKey: this.strOrNull(row.idempotency_key),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  // --- Producing ---
  private jobInsertValues(job: NewJobRecord): { id: string; columns: string[]; values: unknown[] } {
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
    return { id, columns, values };
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
    const { id, columns, values } = this.jobInsertValues(job);
    const placeholders = values.map((_, i) => this.ph(i)).join(', ');
    // No RETURNING on MySQL — the id/status/start_after/workflow_id are all known from the input.
    const sql = `INSERT INTO ${this.t(TableName.JOB)} (${columns.join(', ')}) VALUES (${placeholders})`;
    try {
      await this.runMaybeTx(sql, values, tx);
      return {
        id,
        status: job.status,
        startAfter: job.startAfter,
        workflowId: job.workflowId ?? null,
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
        `SELECT id, status, start_after, workflow_id FROM ${this.t(TableName.JOB)} WHERE queue_name = ${this.ph(0)} AND singleton_key = ${this.ph(1)} AND status IN ('PENDING','ACTIVE','RETRY')`,
        [job.queueName, job.singletonKey],
        tx,
      );
      if (res.rows[0]) {
        const row = res.rows[0];
        return {
          id: String(row.id),
          status: row.status as JobStatus,
          startAfter: Number(row.start_after),
          workflowId: this.strOrNull(row.workflow_id),
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
      `SELECT id, status, start_after, workflow_id FROM ${this.t(TableName.JOB)} WHERE queue_name = ${this.ph(0)} AND idempotency_key = ${this.ph(1)}`,
      [options.queueName, options.idempotencyKey],
      options.tx,
    );
    if (!res.rows[0]) return null;
    const row = res.rows[0];
    return {
      id: String(row.id),
      status: row.status as JobStatus,
      startAfter: Number(row.start_after),
      workflowId: this.strOrNull(row.workflow_id),
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
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} WHERE queue_name = ${this.ph(0)} AND idempotency_key = ${this.ph(1)}`,
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
    // allowed to coexist by design; the caller enforces idempotency-key dedup ahead of this call.
    const id = schedule.id ?? uuid();
    const cols = [
      'id',
      'queue_name',
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
      'idempotency_key',
      'created_at',
      'updated_at',
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
    // No RETURNING on MySQL — insert, then read the row back by its known id.
    await this.runMaybeTx(
      `INSERT INTO ${this.t(TableName.SCHEDULE)} (${cols.join(', ')}) VALUES (${placeholders})`,
      vals,
      tx,
    );
    const res = await this.runMaybeTx(
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} WHERE id = ${this.ph(0)}`,
      [id],
      tx,
    );
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
    queueName: string;
    limit: number;
    lockDurationMs: number;
    now: number;
    lockedByInstanceId: string;
    instanceKey?: string | null;
  }): Promise<JobRecord[]> {
    const { queueName, limit, lockDurationMs, now, lockedByInstanceId, instanceKey } = options;
    const lockedUntil = now + lockDurationMs;

    // Select claimable ids highest-priority-first, locking them for the transaction with SKIP
    // LOCKED so concurrent claimers never contend. Affinity (a preferred key pattern) can't be
    // expressed in portable SQL, so in multi-instance mode we page and filter in code.
    return this.transaction(async (session) => {
      const ids: string[] = [];
      if (!instanceKey) {
        const sel = await this.execute(
          `SELECT id FROM ${this.t(TableName.JOB)} WHERE queue_name = ${this.ph(0)} AND status IN ('PENDING','RETRY') ` +
            `AND start_after <= ${this.ph(1)} AND (expire_at IS NULL OR expire_at > ${this.ph(2)}) ` +
            `ORDER BY priority DESC, start_after ASC LIMIT ${this.ph(3)} FOR UPDATE SKIP LOCKED`,
          [queueName, now, now, limit],
          session,
        );
        for (const row of sel.rows) ids.push(String(row.id));
      } else {
        // Page through candidates, keeping only those this instance's key matches (see the
        // Postgres driver for the rationale behind paging rather than one capped window).
        const pageSize = Math.min(Math.max(limit * 5, limit + 20), 500);
        const maxScan = Math.max(pageSize * 20, 2000);
        const idSet = new Set<string>();
        for (let offset = 0; idSet.size < limit && offset < maxScan; offset += pageSize) {
          const sel = await this.execute(
            `SELECT id, preferred_instance_key_pattern FROM ${this.t(TableName.JOB)} WHERE queue_name = ${this.ph(0)} AND status IN ('PENDING','RETRY') ` +
              `AND start_after <= ${this.ph(1)} AND (expire_at IS NULL OR expire_at > ${this.ph(2)}) ` +
              `ORDER BY priority DESC, start_after ASC LIMIT ${this.ph(3)} OFFSET ${this.ph(4)} FOR UPDATE SKIP LOCKED`,
            [queueName, now, now, pageSize, offset],
            session,
          );
          if (sel.rows.length === 0) break;
          for (const row of sel.rows) {
            if (matchesInstance(this.strOrNull(row.preferred_instance_key_pattern), instanceKey)) {
              idSet.add(String(row.id));
              if (idSet.size >= limit) break;
            }
          }
          if (sel.rows.length < pageSize) break;
        }
        ids.push(...idSet);
      }
      if (ids.length === 0) return [];

      // Guarded UPDATE of exactly the locked ids, then read them back (no RETURNING on MySQL).
      const idPh = ids.map((_, i) => this.ph(5 + i)).join(', ');
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET status = 'ACTIVE', started_at = ${this.ph(0)}, locked_until = ${this.ph(1)}, ` +
          `locked_by_instance_id = ${this.ph(2)}, processed_on_instance_key = ${this.ph(3)}, updated_at = ${this.ph(4)} ` +
          `WHERE id IN (${idPh}) AND status IN ('PENDING','RETRY')`,
        [now, lockedUntil, lockedByInstanceId, instanceKey ?? null, now, ...ids],
        session,
      );
      const readPh = ids.map((_, i) => this.ph(i)).join(', ');
      const res = await this.execute(
        `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} WHERE id IN (${readPh}) AND status = 'ACTIVE' AND locked_until = ${this.ph(ids.length)}`,
        [...ids, lockedUntil],
        session,
      );
      return res.rows
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
    // Complete-this + spawn-next in ONE transaction. The spawned id is known (no RETURNING).
    return this.transaction(async (session) => {
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET status = 'COMPLETED', return_value = ${this.ph(0)}, completed_at = ${this.ph(1)}, updated_at = ${this.ph(2)}, locked_until = NULL WHERE id = ${this.ph(3)}`,
        [this.toJson(options.returnValue), options.now, options.now, options.jobId],
        session,
      );
      if (!options.spawn) return null;
      const { id, columns, values } = this.jobInsertValues(options.spawn);
      const placeholders = values.map((_, i) => this.ph(i)).join(', ');
      await this.execute(
        `INSERT INTO ${this.t(TableName.JOB)} (${columns.join(', ')}) VALUES (${placeholders})`,
        values,
        session,
      );
      return {
        id,
        status: options.spawn.status,
        startAfter: options.spawn.startAfter,
        workflowId: options.spawn.workflowId ?? null,
        deduplicated: false,
      };
    });
  }

  async reclaimStalledJobs(options: { queueName?: string; now: number }): Promise<JobRecord[]> {
    return this.transaction(async (session) => {
      const params: unknown[] = [options.now];
      let where = `status = 'ACTIVE' AND locked_until IS NOT NULL AND locked_until < ${this.ph(0)}`;
      if (options.queueName) {
        where += ` AND queue_name = ${this.ph(1)}`;
        params.push(options.queueName);
      }
      // Read the affected ids first (no RETURNING), flip them to PENDING, then read the rows back.
      const sel = await this.execute(
        `SELECT id FROM ${this.t(TableName.JOB)} WHERE ${where}`,
        params,
        session,
      );
      const ids = sel.rows.map((r) => String(r.id));
      if (ids.length === 0) return [];
      const idPh = ids.map((_, i) => this.ph(1 + i)).join(', ');
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET status = 'PENDING', stalled_at = ${this.ph(0)}, locked_until = NULL, locked_by_instance_id = NULL WHERE id IN (${idPh})`,
        [options.now, ...ids],
        session,
      );
      const readPh = ids.map((_, i) => this.ph(i)).join(', ');
      const res = await this.execute(
        `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} WHERE id IN (${readPh})`,
        ids,
        session,
      );
      return res.rows.map((r) => this.mapJob(r));
    });
  }

  async expireDueJobs(options: { queueName?: string; now: number }): Promise<JobRecord[]> {
    return this.transaction(async (session) => {
      const params: unknown[] = [options.now];
      let where = `status IN ('PENDING','RETRY') AND expire_at IS NOT NULL AND expire_at <= ${this.ph(0)}`;
      if (options.queueName) {
        where += ` AND queue_name = ${this.ph(1)}`;
        params.push(options.queueName);
      }
      const sel = await this.execute(
        `SELECT id FROM ${this.t(TableName.JOB)} WHERE ${where}`,
        params,
        session,
      );
      const ids = sel.rows.map((r) => String(r.id));
      if (ids.length === 0) return [];
      const idPh = ids.map((_, i) => this.ph(2 + i)).join(', ');
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET status = 'EXPIRED', expired_at = ${this.ph(0)}, updated_at = ${this.ph(1)}, locked_until = NULL WHERE id IN (${idPh})`,
        [options.now, options.now, ...ids],
        session,
      );
      const readPh = ids.map((_, i) => this.ph(i)).join(', ');
      const res = await this.execute(
        `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} WHERE id IN (${readPh})`,
        ids,
        session,
      );
      return res.rows.map((r) => this.mapJob(r));
    });
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
      `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} WHERE id = ${this.ph(0)}`,
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
      clauses.push(`queue_name = ${this.ph(params.length)}`);
      params.push(options.queueName);
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
    if (options.processedOnInstanceKey) {
      clauses.push(`processed_on_instance_key = ${this.ph(params.length)}`);
      params.push(options.processedOnInstanceKey);
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

  async countJobsByStatus(options: {
    queueName?: string;
    processedOnInstanceKey?: string;
  }): Promise<Record<JobStatus, number>> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.queueName) {
      clauses.push(`queue_name = ${this.ph(params.length)}`);
      params.push(options.queueName);
    }
    if (options.processedOnInstanceKey) {
      clauses.push(`processed_on_instance_key = ${this.ph(params.length)}`);
      params.push(options.processedOnInstanceKey);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
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
    const res = await this.execute(`SELECT * FROM ${this.t(TableName.QUEUE)} ORDER BY name ASC`, []);
    return this.mapUnique(res.rows, (r) => this.mapQueue(r), (q) => q.name);
  }

  async listSchedules(options: { queueName?: string }): Promise<ScheduleRow[]> {
    const params: unknown[] = [];
    let where = '';
    if (options.queueName) {
      where = `WHERE queue_name = ${this.ph(0)}`;
      params.push(options.queueName);
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
    queueName?: string;
    sinceMs: number;
    now: number;
  }): Promise<ThroughputPoint[]> {
    const params: unknown[] = [options.sinceMs];
    let where = `(completed_at IS NOT NULL OR failed_at IS NOT NULL) AND updated_at >= ${this.ph(0)}`;
    if (options.queueName) {
      where += ` AND queue_name = ${this.ph(1)}`;
      params.push(options.queueName);
    }
    const res = await this.execute(
      `SELECT status, completed_at, failed_at FROM ${this.t(TableName.JOB)} WHERE ${where}`,
      params,
    );
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

  async removeJobsByIds(options: { jobIds: string[]; queueName: string }): Promise<number> {
    if (!options.jobIds.length) return 0;
    const idPh = options.jobIds.map((_, i) => this.ph(i)).join(', ');
    const res = await this.execute(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE id IN (${idPh}) AND queue_name = ${this.ph(options.jobIds.length)}`,
      [...options.jobIds, options.queueName],
    );
    return res.rowCount;
  }

  async removeJobsByStatus(options: { queueName: string; statuses: JobStatus[] }): Promise<number> {
    if (!options.statuses.length) return 0;
    const statusPh = options.statuses.map((_, i) => this.ph(i)).join(', ');
    const res = await this.execute(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE status IN (${statusPh}) AND queue_name = ${this.ph(options.statuses.length)}`,
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
      sets.push(`processing_paused = ${this.ph(params.length)}`);
      params.push(this.boolIn(options.processingPaused));
    }
    if (options.acceptingPaused !== undefined) {
      sets.push(`accepting_paused = ${this.ph(params.length)}`);
      params.push(this.boolIn(options.acceptingPaused));
    }
    sets.push(`updated_at = ${this.ph(params.length)}`);
    params.push(options.now);
    params.push(options.queueName);
    await this.runMaybeTx(
      `UPDATE ${this.t(TableName.QUEUE)} SET ${sets.join(', ')} WHERE name = ${this.ph(params.length - 1)}`,
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
    // Get-or-create, not an UPSERT. No unique index on name; a rare creation race can leave two
    // rows, and listQueues/getQueueByName dedupe by name so callers never see both.
    await this.runMaybeTx(
      `INSERT INTO ${this.t(TableName.QUEUE)} (name, processing_paused, accepting_paused, created_at, updated_at) VALUES (${this.ph(0)}, 0, 0, ${this.ph(1)}, ${this.ph(2)})`,
      [options.name, options.now, options.now],
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

  async deleteQueue(options: { name: string; tx?: TransactionHandle }): Promise<boolean> {
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.QUEUE)} WHERE name = ${this.ph(0)}`,
      [options.name],
      options.tx,
    );
    return res.rowCount > 0;
  }

  // --- Instance liveness & per-instance pause ---
  async upsertInstance(options: { instanceKey: string; now: number }): Promise<InstanceRow> {
    // Update-first, then insert if absent — NOT a database UPSERT. The heartbeat's common case is
    // "row exists"; only the first beat falls through to INSERT. No RETURNING on MySQL, so read the
    // row back by key afterwards. A rare create race can leave two rows; listInstances dedupes.
    const updated = await this.execute(
      `UPDATE ${this.t(TableName.INSTANCE)} SET last_seen_at = ${this.ph(0)}, updated_at = ${this.ph(1)} WHERE instance_key = ${this.ph(2)}`,
      [options.now, options.now, options.instanceKey],
    );
    if (updated.rowCount === 0) {
      await this.execute(
        `INSERT INTO ${this.t(TableName.INSTANCE)} (instance_key, processing_paused, created_at, updated_at, last_seen_at) VALUES (${this.ph(0)}, 0, ${this.ph(1)}, ${this.ph(2)}, ${this.ph(3)})`,
        [options.instanceKey, options.now, options.now, options.now],
      );
    }
    const row = await this.getInstance({ instanceKey: options.instanceKey });
    if (!row) throw new DriverQueryError(`Failed to upsert instance '${options.instanceKey}'.`);
    return row;
  }

  async listInstances(): Promise<InstanceRow[]> {
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.INSTANCE)} ORDER BY instance_key ASC`,
      [],
    );
    return this.mapUnique(res.rows, (r) => this.mapInstance(r), (i) => i.instanceKey);
  }

  async getInstance(options: { instanceKey: string }): Promise<InstanceRow | null> {
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.INSTANCE)} WHERE instance_key = ${this.ph(0)}`,
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
      `UPDATE ${this.t(TableName.INSTANCE)} SET processing_paused = ${this.ph(0)}, updated_at = ${this.ph(1)} WHERE instance_key = ${this.ph(2)}`,
      [this.boolIn(options.processingPaused), options.now, options.instanceKey],
    );
  }

  async deleteInstance(options: {
    instanceKey: string;
    tx?: TransactionHandle;
  }): Promise<boolean> {
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.INSTANCE)} WHERE instance_key = ${this.ph(0)}`,
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
    // MySQL forbids LIMIT inside an `IN (SELECT ... LIMIT)` subquery, so wrap it one level deeper.
    const res = await this.execute(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE id IN (SELECT id FROM (SELECT id FROM ${this.t(TableName.JOB)} WHERE status IN (${statusPh}) ` +
        `AND retention_mode = 'DELETE_AFTER' AND retention_ttl_ms IS NOT NULL ` +
        `AND (COALESCE(completed_at, failed_at, cancelled_at, expired_at, updated_at) + retention_ttl_ms) <= ${cutoffPh} LIMIT ${limitPh}) AS victims)`,
      [...options.statuses, options.olderThan, options.limit],
    );
    return res.rowCount;
  }

  // --- Pub/sub (unsupported: MySQL has no LISTEN/NOTIFY; the safety poll backstops it) ---
  async notify(_options: { channel: string; payload: string }): Promise<void> {
    // No-op — MySQL does not implement LISTEN/NOTIFY.
  }

  async subscribe(_options: {
    channel: string;
    onNotification: (payload: string) => void;
  }): Promise<Subscription> {
    throw new UnsupportedCapabilityError(
      DriverCapability.LISTEN_NOTIFY,
      'MySQL has no LISTEN/NOTIFY; PortQueue uses interval polling instead. Core should not call subscribe() without the LISTEN_NOTIFY capability.',
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
