import { createHash } from 'node:crypto';
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
import { POSTGRES_MIGRATIONS } from './migrations';
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

export interface PostgresDriverOptions {
  connectionString?: string;
  /** An existing `pg.Pool` to share with the app. */
  pool?: unknown;
  /** Any `pg.PoolConfig` (host/user/password/database/…). */
  config?: Record<string, unknown>;
  /** DB schema for all objects (Postgres). */
  schema?: string;
  /** Prefix for all created tables (default 'pq_'). */
  tablePrefix?: string;
  /** Logical prefix for pub/sub channels when multiple PortQueues share one DB. */
  namespace?: string;
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
] as const;

/**
 * Postgres driver — the full-feature reference driver, standalone: it owns the entire SQL surface
 * (no shared base class) so a Postgres-specific change never touches another engine. `$1`-style
 * placeholders, LISTEN/NOTIFY on a dedicated connection, advisory locks for leader-only tasks,
 * SKIP LOCKED claiming, RETURNING everywhere. No method emits a relational JOIN — relationships
 * resolve by name/key lookups, and the schema carries no unique index, so name-uniqueness and
 * idempotency/singleton dedup are enforced here in code. The `pg` package is an optional peer.
 */
export class PostgresDriver implements Driver {
  readonly engine = DatabaseEngine.POSTGRES;
  readonly capabilities: DriverCapabilitySet = capabilities({
    [DriverCapability.SKIP_LOCKED]: true,
    [DriverCapability.RETURNING]: true,
    [DriverCapability.TRANSACTIONS]: true,
    [DriverCapability.LISTEN_NOTIFY]: true,
    [DriverCapability.ADVISORY_LOCK]: true,
  });
  readonly migrations = toMigrationSteps(POSTGRES_MIGRATIONS);

  readonly context: DriverContext;
  private pool: PgPool | null = null;
  private listenClient: PgClient | null = null;
  private readonly listeners = new Map<string, Set<(payload: string) => void>>();
  private readonly options: PostgresDriverOptions;

  constructor(options: PostgresDriverOptions = {}) {
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
      throw new MissingPeerDependencyError('pg', 'Postgres');
    }
    try {
      const config: Record<string, unknown> = { ...this.options.config };
      if (this.options.connectionString) config.connectionString = this.options.connectionString;
      this.pool = new pg.Pool(config);
      await this.pool.query('SELECT 1');
    } catch (err) {
      throw new DriverConnectionError('Failed to connect to Postgres.', err);
    }
  }

  async disconnect(): Promise<void> {
    this.listenClient?.release();
    this.listenClient = null;
    if (this.pool && !this.options.pool) await this.pool.end();
    this.pool = null;
  }

  private async execute(
    sql: string,
    params: readonly unknown[],
    session?: Session,
  ): Promise<RawResult> {
    const target = (session as PgClient | undefined) ?? this.pool;
    if (!target) throw new DriverConnectionError('Postgres driver is not connected.');
    const res = await target.query(sql, params);
    return { rows: res.rows ?? [], rowCount: res.rowCount ?? res.rows?.length ?? 0 };
  }

  private async transaction<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    if (!this.pool) throw new DriverConnectionError('Postgres driver is not connected.');
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
      jobOptions: (this.fromJson(row[ScheduleColumn.JOB_OPTIONS]) as ScheduledJobOptions | null) ?? null,
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
    const sql = `INSERT INTO ${this.t(TableName.JOB)} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING ${JobColumn.ID}, ${JobColumn.STATUS}, ${JobColumn.START_AFTER}`;
    try {
      const res = await this.runMaybeTx(sql, values, tx);
      const row = res.rows[0]!;
      return {
        id: String(row[JobColumn.ID]),
        status: row[JobColumn.STATUS] as JobStatus,
        startAfter: Number(row[JobColumn.START_AFTER]),
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
      ScheduleColumn.JOB_OPTIONS,
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
      this.toJson(schedule.jobOptions),
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
    lockDurationMs: number;
    now: number;
    instanceKey?: string | null;
  }): Promise<JobRecord[]> {
    const { queueName, limit, lockDurationMs, now, instanceKey } = options;
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
            `${JobColumn.UPDATED_AT} = ${this.ph(2)} ` +
            `WHERE ${JobColumn.ID} IN (SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(3)} AND ${JobColumn.STATUS} IN ('${JobStatus.PENDING}','${JobStatus.RETRY}') ` +
            `AND ${JobColumn.START_AFTER} <= ${this.ph(4)} AND (${JobColumn.EXPIRE_AT} IS NULL OR ${JobColumn.EXPIRE_AT} > ${this.ph(5)}) ` +
            `ORDER BY ${JobColumn.PRIORITY} DESC, ${JobColumn.START_AFTER} ASC LIMIT ${this.ph(6)}${skipLocked}) RETURNING ${cols}`,
          [now, lockedUntil, now, queueName, now, now, limit],
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
      if (sel.rows.length < pageSize) break; // last (partial) page
    }
    if (idSet.size === 0) return [];
    const ids = [...idSet];
    return this.transaction(async (session) => {
      const setParams = [now, lockedUntil, instanceKey, now];
      const idPh = ids.map((_, i) => this.ph(setParams.length + i)).join(', ');
      const upd = await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.ACTIVE}', ${JobColumn.STARTED_AT} = ${this.ph(0)}, ${JobColumn.LOCKED_UNTIL} = ${this.ph(1)}, ` +
          `${JobColumn.PROCESSED_ON_INSTANCE_KEY} = ${this.ph(2)}, ${JobColumn.UPDATED_AT} = ${this.ph(3)} ` +
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
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = '${JobStatus.PENDING}', ${JobColumn.STALLED_AT} = ${this.ph(0)}, ${JobColumn.LOCKED_UNTIL} = NULL WHERE ${where} RETURNING ${cols}`,
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

  async requeueJob(options: { jobId: string; now: number; tx?: TransactionHandle }): Promise<InsertedJobRow> {
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
  async cancelJob(options: { jobId: string; now: number; tx?: TransactionHandle }): Promise<boolean> {
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

  async removeJobsByIds(options: { jobIds: string[]; queueName: string; tx?: TransactionHandle }): Promise<number> {
    if (!options.jobIds.length) return 0;
    const idPh = options.jobIds.map((_, i) => this.ph(i)).join(', ');
    // Placeholder appearance order (IN list, then queue_name, then status) must match the params
    // array so positional-bind engines (SQLite '?') and indexed engines ('$n') both work.
    // ACTIVE (running) jobs are never removed — they're skipped and left out of the returned count.
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} IN (${idPh}) AND ${JobColumn.QUEUE_NAME} = ${this.ph(options.jobIds.length)} AND ${JobColumn.STATUS} != ${this.ph(options.jobIds.length + 1)}`,
      [...options.jobIds, options.queueName, JobStatus.ACTIVE],
      options.tx,
    );
    return res.rowCount;
  }

  async removeJobsByStatus(options: { queueName: string; statuses: JobStatus[]; tx?: TransactionHandle }): Promise<number> {
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
    // Get-or-create, not an UPSERT: a queue is created once then only read, so a plain
    // SELECT-then-INSERT is enough and avoids `ON CONFLICT`/`MERGE` (which sharded engines reject
    // without the shard key). No unique index on name; a rare creation race can leave two rows,
    // and listQueues/getQueueByName dedupe by name so callers never see both.
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

  /** WHERE clauses for an instance-list filter, appending each value to `params`. */
  private instanceFilterClauses(options: InstanceListFilter, params: unknown[]): string {
    const clauses: string[] = [];
    if (options.search) {
      clauses.push(`LOWER(${InstanceColumn.INSTANCE_KEY}) LIKE ${this.ph(params.length)} ESCAPE '!'`);
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

  // --- Pub/sub (LISTEN/NOTIFY on a dedicated connection) ---
  private channel(name: string): string {
    // Sanitize to a safe channel token — hash arbitrary names.
    const token = createHash('sha1')
      .update(`${this.context.namespace}:${name}`)
      .digest('hex')
      .slice(0, 40);
    return `pq_${token}`;
  }

  async notify(options: { channel: string; payload: string }): Promise<void> {
    if (!this.pool) return;
    await this.pool.query('SELECT pg_notify($1, $2)', [
      this.channel(options.channel),
      options.payload.slice(0, 7000),
    ]);
  }

  async subscribe(options: {
    channel: string;
    onNotification: (payload: string) => void;
  }): Promise<Subscription> {
    if (!this.pool) throw new DriverConnectionError('Postgres driver is not connected.');
    const ch = this.channel(options.channel);
    if (!this.listenClient) {
      this.listenClient = await this.pool.connect();
      this.listenClient.on('notification', (msg) => {
        const set = this.listeners.get(msg.channel);
        if (set) for (const cb of set) cb(msg.payload ?? '');
      });
    }
    let set = this.listeners.get(ch);
    if (!set) {
      set = new Set();
      this.listeners.set(ch, set);
      await this.listenClient.query(`LISTEN "${ch}"`);
    }
    set.add(options.onNotification);
    return {
      unsubscribe: async () => {
        set!.delete(options.onNotification);
        if (set!.size === 0) {
          this.listeners.delete(ch);
          await this.listenClient?.query(`UNLISTEN "${ch}"`).catch(() => undefined);
        }
      },
    };
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
