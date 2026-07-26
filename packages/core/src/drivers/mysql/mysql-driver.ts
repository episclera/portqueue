import {
  DatabaseEngine,
  DeduplicationReason,
  RetentionMode,
  BackoffStrategy,
} from '../../options/enums';
import { JobStatus } from '../../jobs/job-state.enum';
import { capabilities, DriverCapability, type DriverCapabilitySet } from '../driver-capabilities';
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
import { MYSQL_MIGRATIONS } from './migrations';
import type {
  Driver,
  DriverProbe,
  InstanceListFilter,
  MigrationStep,
  PageWindow,
  QueueListFilter,
  ScheduleListFilter,
  Subscription,
} from '../driver.interface';
import { DriverContext } from '../driver-context';
import type {
  InsertedJobRow,
  InstanceMetrics,
  InstanceRow,
  JobRecord,
  NewJobRecord,
  NewScheduleRow,
  QueueRow,
  ScheduledJobOptions,
  ScheduleRow,
} from '../../jobs/job-record';
import type { QueueOptions } from '../../options/queue-options';
import type { TransactionHandle, TxQueryResult } from '../../tx/transaction-handle';

export interface MysqlDriverOptions {
  /** A `mysql://…` connection URI. */
  connectionString?: string;
  /** An existing `mysql2` pool to share with the app. */
  pool?: unknown;
  /** Any `mysql2` pool config (host/user/password/database/…). */
  config?: Record<string, unknown>;
  /** DB schema/database for all objects. */
  schema?: string;
  /** Prefix for all created tables (default 'pq_'). */
  tablePrefix?: string;
  /** Logical prefix for pub/sub channels when multiple PortQueues share one DB. */
  namespace?: string;
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
  JobColumn.ID,
  JobColumn.QUEUE_NAME,
  JobColumn.STATUS,
  JobColumn.PRIORITY,
  JobColumn.DATA,
  JobColumn.RETURN_VALUE,
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
  JobColumn.PREFERRED_INSTANCE_KEY_PATTERN,
  JobColumn.PROCESSED_ON_INSTANCE_KEY,
  JobColumn.RETRY_ATTEMPT,
  JobColumn.RETRY_MAX_ATTEMPTS,
  JobColumn.RETRY_DELAY_SECONDS,
  JobColumn.RETRY_BACKOFF,
  JobColumn.RETRY_BACKOFF_FACTOR,
  JobColumn.RETRY_MAX_DELAY_SECONDS,
  JobColumn.RETRY_JITTER,
  JobColumn.FAILURE_MESSAGE,
  JobColumn.RETENTION_MODE,
  JobColumn.RETENTION_TTL_SECONDS,
  JobColumn.IDEMPOTENCY_KEY,
  JobColumn.SCHEDULE_ID,
  JobColumn.SINGLETON_KEY,
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

  readonly context: DriverContext;
  private pool: MysqlPool | null = null;
  private readonly options: MysqlDriverOptions;

  constructor(options: MysqlDriverOptions = {}) {
    this.options = options;
    this.context = new DriverContext({
      ...(options.tablePrefix !== undefined ? { tablePrefix: options.tablePrefix } : {}),
      ...(options.schema !== undefined ? { schema: options.schema } : {}),
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
    });
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

  /**
   * The trailing `LIMIT`/`OFFSET` for a list read, appending each bound value to `params`.
   * Returns an empty string when the caller asked for no window, so core's unpaged reads emit
   * exactly the SQL they always did.
   */
  private window(page: PageWindow, params: unknown[]): string {
    let sql = '';
    if (page.limit !== undefined) {
      sql += ` LIMIT ${this.ph(params.length)}`;
      params.push(Math.max(Math.trunc(page.limit), 0));
    }
    if (page.offset !== undefined) {
      sql += ` OFFSET ${this.ph(params.length)}`;
      params.push(Math.max(Math.trunc(page.offset), 0));
    }
    return sql;
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

  async ensureBaseObjects(): Promise<void> {}

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
      preferredInstanceKeyPattern: this.strOrNull(row[JobColumn.PREFERRED_INSTANCE_KEY_PATTERN]),
      processedOnInstanceKey: this.strOrNull(row[JobColumn.PROCESSED_ON_INSTANCE_KEY]),
      retryAttempt: Number(row[JobColumn.RETRY_ATTEMPT]),
      retryMaxAttempts: Number(row[JobColumn.RETRY_MAX_ATTEMPTS]),
      retryDelaySeconds: Number(row[JobColumn.RETRY_DELAY_SECONDS]),
      retryBackoff: row[JobColumn.RETRY_BACKOFF] as BackoffStrategy,
      retryBackoffFactor: this.numOrNull(row[JobColumn.RETRY_BACKOFF_FACTOR]),
      retryMaxDelaySeconds: this.numOrNull(row[JobColumn.RETRY_MAX_DELAY_SECONDS]),
      retryJitter: this.boolOut(row[JobColumn.RETRY_JITTER]),
      failureMessage: this.strOrNull(row[JobColumn.FAILURE_MESSAGE]),
      retentionMode: row[JobColumn.RETENTION_MODE] as RetentionMode,
      retentionTtlSeconds: this.numOrNull(row[JobColumn.RETENTION_TTL_SECONDS]),
      idempotencyKey: this.strOrNull(row[JobColumn.IDEMPOTENCY_KEY]),
      scheduleId: this.strOrNull(row[JobColumn.SCHEDULE_ID]),
      singletonKey: this.strOrNull(row[JobColumn.SINGLETON_KEY]),
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
      cpuPercent: this.numOrNull(row[InstanceColumn.CPU_PERCENT]),
      memoryPercent: this.numOrNull(row[InstanceColumn.MEMORY_PERCENT]),
    };
  }

  private mapSchedule(row: Row): ScheduleRow {
    return {
      id: String(row[ScheduleColumn.ID]),
      queueName: String(row[ScheduleColumn.QUEUE_NAME]),
      cron: this.strOrNull(row[ScheduleColumn.CRON]),
      everySeconds: this.numOrNull(row[ScheduleColumn.EVERY_SECONDS]),
      timezone: this.strOrNull(row[ScheduleColumn.TIMEZONE]),
      data: this.fromJson(row[ScheduleColumn.DATA]),
      jobOptions:
        (this.fromJson(row[ScheduleColumn.JOB_OPTIONS]) as ScheduledJobOptions | null) ?? null,
      priority: this.numOrNull(row[ScheduleColumn.PRIORITY]),
      retryMaxAttempts: this.numOrNull(row[ScheduleColumn.RETRY_MAX_ATTEMPTS]),
      retryDelaySeconds: this.numOrNull(row[ScheduleColumn.RETRY_DELAY_SECONDS]),
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
      job.preferredInstanceKeyPattern,
      null, // processed_on_instance_key (set at claim time)
      job.retryAttempt,
      job.retryMaxAttempts,
      job.retryDelaySeconds,
      job.retryBackoff,
      job.retryBackoffFactor,
      job.retryMaxDelaySeconds,
      this.boolIn(job.retryJitter),
      null, // failure_message
      job.retentionMode,
      job.retentionTtlSeconds,
      job.idempotencyKey,
      job.scheduleId,
      job.singletonKey,
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
    // No RETURNING on MySQL — the id/status/start_after are all known from the input.
    const sql = `INSERT INTO ${this.t(TableName.JOB)} (${columns.join(', ')}) VALUES (${placeholders})`;
    try {
      await this.runMaybeTx(sql, values, tx);
      return {
        id,
        status: job.status,
        startAfter: job.startAfter,
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
        `SELECT ${JobColumn.ID}, ${JobColumn.STATUS}, ${JobColumn.START_AFTER} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.SINGLETON_KEY} = ${this.ph(1)} AND ${JobColumn.STATUS} IN ('${JobStatus.PENDING}','${JobStatus.ACTIVE}','${JobStatus.RETRY}')`,
        [job.queueName, job.singletonKey],
        tx,
      );
      if (res.rows[0]) {
        const row = res.rows[0];
        return {
          id: String(row[JobColumn.ID]),
          status: row[JobColumn.STATUS] as JobStatus,
          startAfter: Number(row[JobColumn.START_AFTER]),
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
      `SELECT ${JobColumn.ID}, ${JobColumn.STATUS}, ${JobColumn.START_AFTER} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.IDEMPOTENCY_KEY} = ${this.ph(1)}`,
      [options.queueName, options.idempotencyKey],
      options.tx,
    );
    if (!res.rows[0]) return null;
    const row = res.rows[0];
    return {
      id: String(row[JobColumn.ID]),
      status: row[JobColumn.STATUS] as JobStatus,
      startAfter: Number(row[JobColumn.START_AFTER]),
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
    // allowed to coexist by design; the caller enforces idempotency-key dedup ahead of this call.
    const id = schedule.id ?? uuid();
    const cols = [
      ScheduleColumn.ID,
      ScheduleColumn.QUEUE_NAME,
      ScheduleColumn.CRON,
      ScheduleColumn.EVERY_SECONDS,
      ScheduleColumn.TIMEZONE,
      ScheduleColumn.DATA,
      ScheduleColumn.JOB_OPTIONS,
      ScheduleColumn.PRIORITY,
      ScheduleColumn.RETRY_MAX_ATTEMPTS,
      ScheduleColumn.RETRY_DELAY_SECONDS,
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
      schedule.everySeconds,
      schedule.timezone,
      this.toJson(schedule.data),
      this.toJson(schedule.jobOptions),
      schedule.priority,
      schedule.retryMaxAttempts,
      schedule.retryDelaySeconds,
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
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} WHERE ${ScheduleColumn.ID} = ${this.ph(0)}`,
      [id],
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

  async setScheduleEnabled(options: {
    scheduleId: string;
    enabled: boolean;
    now: number;
    tx?: TransactionHandle;
  }): Promise<boolean> {
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.SCHEDULE)} SET ${ScheduleColumn.ENABLED} = ${this.ph(0)}, ${ScheduleColumn.UPDATED_AT} = ${this.ph(1)} WHERE ${ScheduleColumn.ID} = ${this.ph(2)}`,
      [this.boolIn(options.enabled), options.now, options.scheduleId],
      options.tx,
    );
    return res.rowCount > 0;
  }

  // --- Claiming (hot path) ---
  async claimJobs(options: {
    queueName: string;
    limit: number;
    lockDurationSeconds: number;
    now: number;
    instanceKey?: string | null;
  }): Promise<JobRecord[]> {
    const { queueName, limit, lockDurationSeconds, now, instanceKey } = options;
    const lockedUntil = now + lockDurationSeconds * 1000;

    // Select claimable ids highest-priority-first, locking them for the transaction with SKIP
    // LOCKED so concurrent claimers never contend. Affinity (a preferred key pattern) can't be
    // expressed in portable SQL, so in multi-instance mode we page and filter in code.
    return this.transaction(async (session) => {
      const ids: string[] = [];
      if (!instanceKey) {
        const sel = await this.execute(
          `SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.STATUS} IN ('${JobStatus.PENDING}','${JobStatus.RETRY}') ` +
            `AND ${JobColumn.START_AFTER} <= ${this.ph(1)} AND (${JobColumn.EXPIRE_AT} IS NULL OR ${JobColumn.EXPIRE_AT} > ${this.ph(2)}) ` +
            `ORDER BY ${JobColumn.PRIORITY} DESC, ${JobColumn.START_AFTER} ASC LIMIT ${this.ph(3)} FOR UPDATE SKIP LOCKED`,
          [queueName, now, now, limit],
          session,
        );
        for (const row of sel.rows) ids.push(String(row[JobColumn.ID]));
      } else {
        // Page through candidates, keeping only those this instance's key matches (see the
        // Postgres driver for the rationale behind paging rather than one capped window).
        const pageSize = Math.min(Math.max(limit * 5, limit + 20), 500);
        const maxScan = Math.max(pageSize * 20, 2000);
        const idSet = new Set<string>();
        for (let offset = 0; idSet.size < limit && offset < maxScan; offset += pageSize) {
          const sel = await this.execute(
            `SELECT ${JobColumn.ID}, ${JobColumn.PREFERRED_INSTANCE_KEY_PATTERN} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.STATUS} IN ('${JobStatus.PENDING}','${JobStatus.RETRY}') ` +
              `AND ${JobColumn.START_AFTER} <= ${this.ph(1)} AND (${JobColumn.EXPIRE_AT} IS NULL OR ${JobColumn.EXPIRE_AT} > ${this.ph(2)}) ` +
              `ORDER BY ${JobColumn.PRIORITY} DESC, ${JobColumn.START_AFTER} ASC LIMIT ${this.ph(3)} OFFSET ${this.ph(4)} FOR UPDATE SKIP LOCKED`,
            [queueName, now, now, pageSize, offset],
            session,
          );
          if (sel.rows.length === 0) break;
          for (const row of sel.rows) {
            if (
              matchesInstance(
                this.strOrNull(row[JobColumn.PREFERRED_INSTANCE_KEY_PATTERN]),
                instanceKey,
              )
            ) {
              idSet.add(String(row[JobColumn.ID]));
              if (idSet.size >= limit) break;
            }
          }
          if (sel.rows.length < pageSize) break;
        }
        ids.push(...idSet);
      }
      if (ids.length === 0) return [];

      // Guarded UPDATE of exactly the locked ids, then read them back (no RETURNING on MySQL).
      const idPh = ids.map((_, i) => this.ph(4 + i)).join(', ');
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.ACTIVE}', ${JobColumn.STARTED_AT} = ${this.ph(0)}, ${JobColumn.LOCKED_UNTIL} = ${this.ph(1)}, ` +
          `${JobColumn.PROCESSED_ON_INSTANCE_KEY} = ${this.ph(2)}, ${JobColumn.UPDATED_AT} = ${this.ph(3)} ` +
          `WHERE ${JobColumn.ID} IN (${idPh}) AND ${JobColumn.STATUS} IN ('${JobStatus.PENDING}','${JobStatus.RETRY}')`,
        [now, lockedUntil, instanceKey ?? null, now, ...ids],
        session,
      );
      const readPh = ids.map((_, i) => this.ph(i)).join(', ');
      const res = await this.execute(
        `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} IN (${readPh}) AND ${JobColumn.STATUS} = '${JobStatus.ACTIVE}' AND ${JobColumn.LOCKED_UNTIL} = ${this.ph(ids.length)}`,
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
    lockDurationSeconds: number;
    now: number;
  }): Promise<boolean> {
    const res = await this.execute(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.LOCKED_UNTIL} = ${this.ph(0)}, ${JobColumn.UPDATED_AT} = ${this.ph(1)} WHERE ${JobColumn.ID} = ${this.ph(2)} AND ${JobColumn.STATUS} = '${JobStatus.ACTIVE}'`,
      [options.now + options.lockDurationSeconds * 1000, options.now, options.jobId],
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

  async reclaimStalledJobs(options: { queueName?: string; now: number }): Promise<JobRecord[]> {
    return this.transaction(async (session) => {
      const params: unknown[] = [options.now];
      let where = `${JobColumn.STATUS} = '${JobStatus.ACTIVE}' AND ${JobColumn.LOCKED_UNTIL} IS NOT NULL AND ${JobColumn.LOCKED_UNTIL} < ${this.ph(0)}`;
      if (options.queueName) {
        where += ` AND ${JobColumn.QUEUE_NAME} = ${this.ph(1)}`;
        params.push(options.queueName);
      }
      // Read the affected ids first (no RETURNING), flip them to PENDING, then read the rows back.
      const sel = await this.execute(
        `SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} WHERE ${where}`,
        params,
        session,
      );
      const ids = sel.rows.map((r) => String(r[JobColumn.ID]));
      if (ids.length === 0) return [];
      const idPh = ids.map((_, i) => this.ph(1 + i)).join(', ');
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.PENDING}', ${JobColumn.STALLED_AT} = ${this.ph(0)}, ${JobColumn.LOCKED_UNTIL} = NULL WHERE ${JobColumn.ID} IN (${idPh})`,
        [options.now, ...ids],
        session,
      );
      const readPh = ids.map((_, i) => this.ph(i)).join(', ');
      const res = await this.execute(
        `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} IN (${readPh})`,
        ids,
        session,
      );
      return res.rows.map((r) => this.mapJob(r));
    });
  }

  async expireDueJobs(options: { queueName?: string; now: number }): Promise<JobRecord[]> {
    return this.transaction(async (session) => {
      const params: unknown[] = [options.now];
      let where = `${JobColumn.STATUS} IN ('${JobStatus.PENDING}','${JobStatus.RETRY}') AND ${JobColumn.EXPIRE_AT} IS NOT NULL AND ${JobColumn.EXPIRE_AT} <= ${this.ph(0)}`;
      if (options.queueName) {
        where += ` AND ${JobColumn.QUEUE_NAME} = ${this.ph(1)}`;
        params.push(options.queueName);
      }
      const sel = await this.execute(
        `SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} WHERE ${where}`,
        params,
        session,
      );
      const ids = sel.rows.map((r) => String(r[JobColumn.ID]));
      if (ids.length === 0) return [];
      const idPh = ids.map((_, i) => this.ph(2 + i)).join(', ');
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.EXPIRED}', ${JobColumn.EXPIRED_AT} = ${this.ph(0)}, ${JobColumn.UPDATED_AT} = ${this.ph(1)}, ${JobColumn.LOCKED_UNTIL} = NULL WHERE ${JobColumn.ID} IN (${idPh})`,
        [options.now, options.now, ...ids],
        session,
      );
      const readPh = ids.map((_, i) => this.ph(i)).join(', ');
      const res = await this.execute(
        `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} IN (${readPh})`,
        ids,
        session,
      );
      return res.rows.map((r) => this.mapJob(r));
    });
  }

  async requeueJob(options: {
    jobId: string;
    now: number;
    tx?: TransactionHandle;
  }): Promise<InsertedJobRow> {
    // On the caller's transaction when there is one. A read issued outside an in-flight
    // transaction blocks behind it on a single-connection engine — a deadlock, not a slow query.
    const job = await this.getJob({
      jobId: options.jobId,
      ...(options.tx ? { tx: options.tx } : {}),
    });
    if (!job) throw new DriverQueryError(`Cannot requeue: job '${options.jobId}' not found.`);
    // Re-arm this job's own row: back to PENDING, reset retry counters/lock/timestamps.
    await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.PENDING}', ${JobColumn.RETRY_ATTEMPT} = 0, ${JobColumn.START_AFTER} = ${this.ph(0)}, ` +
        `${JobColumn.FAILED_AT} = NULL, ${JobColumn.FAILURE_MESSAGE} = NULL, ${JobColumn.COMPLETED_AT} = NULL, ${JobColumn.STARTED_AT} = NULL, ${JobColumn.CANCELLED_AT} = NULL, ${JobColumn.EXPIRED_AT} = NULL, ` +
        `${JobColumn.LOCKED_UNTIL} = NULL, ${JobColumn.UPDATED_AT} = ${this.ph(1)} WHERE ${JobColumn.ID} = ${this.ph(2)}`,
      [options.now, options.now, options.jobId],
      options.tx,
    );
    return {
      id: job.id,
      status: JobStatus.PENDING,
      startAfter: options.now,
      deduplicated: false,
    };
  }

  // --- Reading ---
  async getJob(options: { jobId: string; tx?: TransactionHandle }): Promise<JobRecord | null> {
    const res = await this.runMaybeTx(
      `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} = ${this.ph(0)}`,
      [options.jobId],
      options.tx,
    );
    return res.rows[0] ? this.mapJob(res.rows[0]) : null;
  }

  /**
   * WHERE clauses for a job filter, appending each value to `params`. Shared by `getJobs` and
   * `countJobs` so a page and its total can never disagree about what they select.
   */
  private jobFilterClauses(
    options: {
      queueName?: string;
      statuses?: JobStatus[];
      scheduleId?: string;
      processedOnInstanceKey?: string;
    },
    params: unknown[],
  ): string {
    const clauses: string[] = [];
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
    if (options.processedOnInstanceKey) {
      clauses.push(`${JobColumn.PROCESSED_ON_INSTANCE_KEY} = ${this.ph(params.length)}`);
      params.push(options.processedOnInstanceKey);
    }
    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  }

  async getJobs(options: {
    queueName?: string;
    statuses?: JobStatus[];
    scheduleId?: string;
    processedOnInstanceKey?: string;
    limit: number;
    offset: number;
    order: 'asc' | 'desc';
  }): Promise<JobRecord[]> {
    const params: unknown[] = [];
    const where = this.jobFilterClauses(options, params);
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

  async countJobs(options: {
    queueName?: string;
    statuses?: JobStatus[];
    scheduleId?: string;
    processedOnInstanceKey?: string;
  }): Promise<number> {
    const params: unknown[] = [];
    const where = this.jobFilterClauses(options, params);
    const res = await this.execute(
      `SELECT COUNT(*) AS c FROM ${this.t(TableName.JOB)} ${where}`,
      params,
    );
    return Number(res.rows[0]?.c ?? 0);
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

  /**
   * Per-status counts for many queues in one grouped pass. One query replaces the
   * `countJobsByStatus`-per-row storm a queue list page would otherwise issue.
   */
  async countJobsByStatusPerQueue(options: {
    queueNames: string[];
  }): Promise<Record<string, Record<JobStatus, number>>> {
    return this.countByStatusGrouped(JobColumn.QUEUE_NAME, options.queueNames);
  }

  async countJobsByStatusPerInstance(options: {
    instanceKeys: string[];
  }): Promise<Record<string, Record<JobStatus, number>>> {
    return this.countByStatusGrouped(JobColumn.PROCESSED_ON_INSTANCE_KEY, options.instanceKeys);
  }

  /** The shared `GROUP BY <key>, status` read behind both per-key count breakdowns. */
  private async countByStatusGrouped(
    keyColumn: JobColumn,
    keys: string[],
  ): Promise<Record<string, Record<JobStatus, number>>> {
    const out: Record<string, Record<JobStatus, number>> = {};
    for (const key of keys) out[key] = emptyStatusCounts();
    if (!keys.length) return out;
    const placeholders = keys.map((_, i) => this.ph(i)).join(', ');
    const res = await this.execute(
      `SELECT ${keyColumn}, ${JobColumn.STATUS}, COUNT(*) AS c FROM ${this.t(TableName.JOB)} ` +
        `WHERE ${keyColumn} IN (${placeholders}) GROUP BY ${keyColumn}, ${JobColumn.STATUS}`,
      keys,
    );
    for (const row of res.rows) {
      const bucket = out[String(row[keyColumn])];
      if (bucket) bucket[row[JobColumn.STATUS] as JobStatus] = Number(row.c);
    }
    return out;
  }

  /** WHERE clauses for a queue-list filter, appending each value to `params`. */
  private queueFilterClauses(options: QueueListFilter, params: unknown[]): string {
    const clauses: string[] = [];
    if (options.search) {
      clauses.push(`LOWER(${QueueColumn.NAME}) LIKE ${this.ph(params.length)} ESCAPE '!'`);
      params.push(likePattern(options.search));
    }
    if (options.processingPaused !== undefined) {
      clauses.push(`${QueueColumn.PROCESSING_PAUSED} = ${this.ph(params.length)}`);
      params.push(this.boolIn(options.processingPaused));
    }
    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  }

  async listQueues(options: QueueListFilter & PageWindow = {}): Promise<QueueRow[]> {
    const params: unknown[] = [];
    const where = this.queueFilterClauses(options, params);
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.QUEUE)} ${where} ORDER BY ${QueueColumn.NAME} ASC` +
        this.window(options, params),
      params,
    );
    // No unique index on name: dedupe defensively so a creation race can't surface twice.
    return this.mapUnique(
      res.rows,
      (r) => this.mapQueue(r),
      (q) => q.name,
    );
  }

  async countQueues(options: QueueListFilter = {}): Promise<number> {
    const params: unknown[] = [];
    const where = this.queueFilterClauses(options, params);
    const res = await this.execute(
      `SELECT COUNT(*) AS c FROM ${this.t(TableName.QUEUE)} ${where}`,
      params,
    );
    return Number(res.rows[0]?.c ?? 0);
  }

  /** WHERE clauses for a schedule-list filter, appending each value to `params`. */
  private scheduleFilterClauses(options: ScheduleListFilter, params: unknown[]): string {
    const clauses: string[] = [];
    if (options.queueName) {
      clauses.push(`${ScheduleColumn.QUEUE_NAME} = ${this.ph(params.length)}`);
      params.push(options.queueName);
    }
    if (options.enabled !== undefined) {
      clauses.push(`${ScheduleColumn.ENABLED} = ${this.ph(params.length)}`);
      params.push(this.boolIn(options.enabled));
    }
    if (options.search) {
      // A schedule is searchable by any of the three things the table actually shows.
      const pattern = likePattern(options.search);
      const cols = [ScheduleColumn.ID, ScheduleColumn.QUEUE_NAME, ScheduleColumn.CRON];
      const ors = cols.map((col) => {
        const clause = `LOWER(${col}) LIKE ${this.ph(params.length)} ESCAPE '!'`;
        params.push(pattern);
        return clause;
      });
      clauses.push(`(${ors.join(' OR ')})`);
    }
    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  }

  async listSchedules(options: ScheduleListFilter & PageWindow = {}): Promise<ScheduleRow[]> {
    const params: unknown[] = [];
    const where = this.scheduleFilterClauses(options, params);
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} ${where} ` +
        `ORDER BY ${ScheduleColumn.CREATED_AT} ASC, ${ScheduleColumn.ID} ASC` +
        this.window(options, params),
      params,
    );
    return res.rows.map((r) => this.mapSchedule(r));
  }

  async countSchedules(options: ScheduleListFilter = {}): Promise<number> {
    const params: unknown[] = [];
    const where = this.scheduleFilterClauses(options, params);
    const res = await this.execute(
      `SELECT COUNT(*) AS c FROM ${this.t(TableName.SCHEDULE)} ${where}`,
      params,
    );
    return Number(res.rows[0]?.c ?? 0);
  }
  async getSchedule(options: { scheduleId: string }): Promise<ScheduleRow | null> {
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} WHERE ${ScheduleColumn.ID} = ${this.ph(0)}`,
      [options.scheduleId],
    );
    return res.rows[0] ? this.mapSchedule(res.rows[0]) : null;
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
  async cancelJob(options: {
    jobId: string;
    now: number;
    tx?: TransactionHandle;
  }): Promise<boolean> {
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.CANCELLED}', ${JobColumn.CANCELLED_AT} = ${this.ph(0)}, ${JobColumn.UPDATED_AT} = ${this.ph(1)} WHERE ${JobColumn.ID} = ${this.ph(2)} AND ${JobColumn.STATUS} IN ('${JobStatus.PENDING}','${JobStatus.RETRY}')`,
      [options.now, options.now, options.jobId],
      options.tx,
    );
    return res.rowCount > 0;
  }

  async removeJob(options: { jobId: string; tx?: TransactionHandle }): Promise<boolean> {
    // Never delete a running job — an ACTIVE row is skipped and this returns false; cancel it first.
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} = ${this.ph(0)} AND ${JobColumn.STATUS} != ${this.ph(1)}`,
      [options.jobId, JobStatus.ACTIVE],
      options.tx,
    );
    return res.rowCount > 0;
  }

  async removeJobsByIds(options: {
    jobIds: string[];
    queueName: string;
    tx?: TransactionHandle;
  }): Promise<number> {
    if (!options.jobIds.length) return 0;
    const idPh = options.jobIds.map((_, i) => this.ph(i)).join(', ');
    // ACTIVE (running) jobs are never removed — they're skipped and left out of the returned count.
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} IN (${idPh}) AND ${JobColumn.QUEUE_NAME} = ${this.ph(options.jobIds.length)} AND ${JobColumn.STATUS} != ${this.ph(options.jobIds.length + 1)}`,
      [...options.jobIds, options.queueName, JobStatus.ACTIVE],
      options.tx,
    );
    return res.rowCount;
  }

  async removeJobsByStatus(options: {
    queueName: string;
    statuses: JobStatus[];
    tx?: TransactionHandle;
  }): Promise<number> {
    if (!options.statuses.length) return 0;
    const statusPh = options.statuses.map((_, i) => this.ph(i)).join(', ');
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.STATUS} IN (${statusPh}) AND ${JobColumn.QUEUE_NAME} = ${this.ph(options.statuses.length)}`,
      [...options.statuses, options.queueName],
      options.tx,
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
    // Both reads run on the caller's transaction: outside it they would deadlock a
    // single-connection engine, and the read-back below would not see the row just inserted.
    const existing = await this.getQueueByName({
      name: options.name,
      ...(options.tx ? { tx: options.tx } : {}),
    });
    if (existing) return existing;
    // Get-or-create, not an UPSERT. No unique index on name; a rare creation race can leave two
    // rows, and listQueues/getQueueByName dedupe by name so callers never see both.
    await this.runMaybeTx(
      `INSERT INTO ${this.t(TableName.QUEUE)} (${QueueColumn.NAME}, ${QueueColumn.PROCESSING_PAUSED}, ${QueueColumn.ACCEPTING_PAUSED}, ${QueueColumn.CREATED_AT}, ${QueueColumn.UPDATED_AT}) VALUES (${this.ph(0)}, 0, 0, ${this.ph(1)}, ${this.ph(2)})`,
      [options.name, options.now, options.now],
      options.tx,
    );
    const row = await this.getQueueByName({
      name: options.name,
      ...(options.tx ? { tx: options.tx } : {}),
    });
    if (!row) throw new DriverQueryError(`Failed to ensure queue '${options.name}'.`);
    return row;
  }

  async getQueueByName(options: {
    name: string;
    tx?: TransactionHandle;
  }): Promise<QueueRow | null> {
    const res = await this.runMaybeTx(
      `SELECT * FROM ${this.t(TableName.QUEUE)} WHERE ${QueueColumn.NAME} = ${this.ph(0)}`,
      [options.name],
      options.tx,
    );
    return res.rows[0] ? this.mapQueue(res.rows[0]) : null;
  }

  async deleteQueue(options: { name: string; tx?: TransactionHandle }): Promise<boolean> {
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.QUEUE)} WHERE ${QueueColumn.NAME} = ${this.ph(0)}`,
      [options.name],
      options.tx,
    );
    return res.rowCount > 0;
  }

  // --- Instance liveness & per-instance pause ---
  async upsertInstance(options: {
    instanceKey: string;
    now: number;
    metrics?: InstanceMetrics;
  }): Promise<InstanceRow> {
    // Update-first, then insert if absent — NOT a database UPSERT. The heartbeat's common case is
    // "row exists"; only the first beat falls through to INSERT. No RETURNING on MySQL, so read the
    // row back by key afterwards. A rare create race can leave two rows; listInstances dedupes.
    const m = options.metrics;
    const updated = await this.execute(
      `UPDATE ${this.t(TableName.INSTANCE)} SET ${InstanceColumn.LAST_SEEN_AT} = ${this.ph(0)}, ${InstanceColumn.UPDATED_AT} = ${this.ph(1)}, ${InstanceColumn.CPU_PERCENT} = COALESCE(${this.ph(2)}, ${InstanceColumn.CPU_PERCENT}), ${InstanceColumn.MEMORY_PERCENT} = COALESCE(${this.ph(3)}, ${InstanceColumn.MEMORY_PERCENT}) WHERE ${InstanceColumn.INSTANCE_KEY} = ${this.ph(4)}`,
      [
        options.now,
        options.now,
        m?.cpuPercent ?? null,
        m?.memoryPercent ?? null,
        options.instanceKey,
      ],
    );
    if (updated.rowCount === 0) {
      await this.execute(
        `INSERT INTO ${this.t(TableName.INSTANCE)} (${InstanceColumn.INSTANCE_KEY}, ${InstanceColumn.PROCESSING_PAUSED}, ${InstanceColumn.CREATED_AT}, ${InstanceColumn.UPDATED_AT}, ${InstanceColumn.LAST_SEEN_AT}, ${InstanceColumn.CPU_PERCENT}, ${InstanceColumn.MEMORY_PERCENT}) VALUES (${this.ph(0)}, 0, ${this.ph(1)}, ${this.ph(2)}, ${this.ph(3)}, ${this.ph(4)}, ${this.ph(5)})`,
        [
          options.instanceKey,
          options.now,
          options.now,
          options.now,
          m?.cpuPercent ?? null,
          m?.memoryPercent ?? null,
        ],
      );
    }
    const row = await this.getInstance({ instanceKey: options.instanceKey });
    if (!row) throw new DriverQueryError(`Failed to upsert instance '${options.instanceKey}'.`);
    return row;
  }

  /** WHERE clauses for an instance-list filter, appending each value to `params`. */
  private instanceFilterClauses(options: InstanceListFilter, params: unknown[]): string {
    const clauses: string[] = [];
    if (options.search) {
      clauses.push(
        `LOWER(${InstanceColumn.INSTANCE_KEY}) LIKE ${this.ph(params.length)} ESCAPE '!'`,
      );
      params.push(likePattern(options.search));
    }
    if (options.processingPaused !== undefined) {
      clauses.push(`${InstanceColumn.PROCESSING_PAUSED} = ${this.ph(params.length)}`);
      params.push(this.boolIn(options.processingPaused));
    }
    // Liveness is a cutoff the caller computed; the driver only compares against it.
    if (options.alive !== undefined && options.seenSince !== undefined) {
      clauses.push(
        `${InstanceColumn.LAST_SEEN_AT} ${options.alive ? '>=' : '<'} ${this.ph(params.length)}`,
      );
      params.push(options.seenSince);
    }
    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  }

  async listInstances(options: InstanceListFilter & PageWindow = {}): Promise<InstanceRow[]> {
    const params: unknown[] = [];
    const where = this.instanceFilterClauses(options, params);
    const res = await this.execute(
      `SELECT * FROM ${this.t(TableName.INSTANCE)} ${where} ORDER BY ${InstanceColumn.INSTANCE_KEY} ASC` +
        this.window(options, params),
      params,
    );
    return this.mapUnique(
      res.rows,
      (r) => this.mapInstance(r),
      (i) => i.instanceKey,
    );
  }

  async countInstances(options: InstanceListFilter = {}): Promise<number> {
    const params: unknown[] = [];
    const where = this.instanceFilterClauses(options, params);
    const res = await this.execute(
      `SELECT COUNT(*) AS c FROM ${this.t(TableName.INSTANCE)} ${where}`,
      params,
    );
    return Number(res.rows[0]?.c ?? 0);
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

  async deleteInstance(options: { instanceKey: string; tx?: TransactionHandle }): Promise<boolean> {
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
    // MySQL forbids LIMIT inside an `IN (SELECT ... LIMIT)` subquery, so wrap it one level deeper.
    const res = await this.execute(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} IN (SELECT ${JobColumn.ID} FROM (SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.STATUS} IN (${statusPh}) ` +
        `AND ${JobColumn.RETENTION_MODE} = 'DELETE_AFTER' AND ${JobColumn.RETENTION_TTL_SECONDS} IS NOT NULL ` +
        `AND (COALESCE(${JobColumn.COMPLETED_AT}, ${JobColumn.FAILED_AT}, ${JobColumn.CANCELLED_AT}, ${JobColumn.EXPIRED_AT}, ${JobColumn.UPDATED_AT}) + ${JobColumn.RETENTION_TTL_SECONDS} * 1000) <= ${cutoffPh} LIMIT ${limitPh}) AS victims)`,
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

/**
 * A bound `LIKE` pattern for a case-insensitive substring search. The term is lower-cased (the
 * column is too, at the query site) and `%`/`_`/`!` are escaped with `!` — declared by the
 * query's own `ESCAPE '!'` — so a user typing `100%` searches for that text rather than matching
 * everything. Still a bound parameter: nothing here is interpolated into SQL.
 */
function likePattern(term: string): string {
  const escaped = term.toLowerCase().replace(/[!%_]/g, (ch) => `!${ch}`);
  return `%${escaped}%`;
}
