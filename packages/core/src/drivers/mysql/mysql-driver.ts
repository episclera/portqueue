import { DatabaseEngine, DeduplicationReason } from '../../options/enums';
import { ACTIVE_STATUSES, FINISHED_STATUSES, JobStatus } from '../../jobs/job-state.enum';
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
import {
  BaseDriver,
  JOB_COLUMNS,
  SCHEDULE_INSERT_COLUMNS,
  type RawResult,
  type Row,
  type Session,
} from '../shared/base-driver';
import { retentionStatusBit } from '../shared/retention-statuses';
import { MS_PER_SECOND } from '../../util/seconds';
import { toMigrationSteps } from '../shared/migration';
import { MYSQL_MIGRATIONS } from './migrations';
import type {
  Driver,
  DriverProbe,
  InstanceListFilter,
  JobListFilter,
  JobRef,
  MigrationStep,
  PageWindow,
  QueueListFilter,
  RequeuedJobRef,
  ScheduleListFilter,
  ScheduleRef,
  StalledJobRef,
  Subscription,
} from '../driver.interface';
import type {
  InsertedJobRow,
  InstanceMetrics,
  InstanceRow,
  JobRecord,
  NewJobRecord,
  NewScheduleRow,
  QueueRow,
  ScheduleRow,
} from '../../jobs/job-record';
import type { QueueOptions } from '../../options/queue-options';
import type { TransactionHandle } from '../../tx/transaction-handle';

export interface MysqlDriverOptions {
  /** A `mysql://…` connection URI. */
  connectionString?: string;
  /** An existing `mysql2` pool to share with the app. */
  pool?: unknown;
  /** Any `mysql2` pool config (host/user/password/database/…). */
  config?: Record<string, unknown>;
  /**
   * DB schema/database for all objects. Every table name is qualified with it and the migration
   * creates it (`CREATE SCHEMA IF NOT EXISTS`), so this is honoured rather than merely accepted.
   */
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

/** `ER_NO_SUCH_TABLE` / `ER_BAD_DB_ERROR` — the only codes that mean "not migrated yet". */
const MYSQL_MISSING_OBJECT = new Set(['ER_NO_SUCH_TABLE', 'ER_BAD_DB_ERROR']);

/**
 * MySQL driver — it owns its entire SQL surface, so a MySQL-specific change never touches another
 * engine. `?` positional placeholders, SKIP LOCKED and transactions (8.0+), real primary keys and
 * inline `KEY` indexes. No LISTEN/NOTIFY and no advisory lock; the polling backstop drives wakeups.
 * No method emits a relational JOIN — relationships resolve by name/key lookups — and
 * idempotency/singleton dedup is enforced here in code rather than by a constraint, so behaviour
 * matches every other engine.
 *
 * **The dialect fact that shapes this file: MySQL has no `RETURNING`.** Every "mutate and read back"
 * operation is therefore an explicit two-step inside one transaction — select the affected ids (with
 * `FOR UPDATE SKIP LOCKED` where the rows are contended), then mutate exactly those ids. That is why
 * several methods here open a transaction where the PostgreSQL driver runs a single statement.
 *
 * Row mapping, value conversion and insert value lists come from {@link BaseDriver} — mechanism,
 * not SQL. `mysql2` is an optional peer dependency.
 */
export class MysqlDriver extends BaseDriver implements Driver {
  readonly engine = DatabaseEngine.MYSQL;
  readonly capabilities: DriverCapabilitySet = capabilities({
    [DriverCapability.SKIP_LOCKED]: true,
    [DriverCapability.TRANSACTIONS]: true,
    // `GET_LOCK` is a genuine named lock, so the migration runner can serialize a concurrent first
    // boot here exactly as it does on PostgreSQL. No RETURNING and no LISTEN/NOTIFY.
    [DriverCapability.ADVISORY_LOCK]: true,
  });
  readonly migrations: MigrationStep[] = toMigrationSteps(MYSQL_MIGRATIONS);

  private pool: MysqlPool | null = null;
  /**
   * Connections holding the advisory locks this driver has taken, keyed by lock name. `GET_LOCK` is
   * scoped to the **session**, so the connection that took a lock is the only one that can release
   * it — and going through the pool would release it on whichever connection came out next.
   */
  private readonly lockConns = new Map<string, MysqlConnection>();
  private readonly options: MysqlDriverOptions;

  constructor(options: MysqlDriverOptions = {}) {
    super({
      ...(options.tablePrefix !== undefined ? { tablePrefix: options.tablePrefix } : {}),
      ...(options.schema !== undefined ? { schema: options.schema } : {}),
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
    });
    this.options = options;
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
    // Returning the connection ends its session, which drops any lock still held on it — the
    // backstop for a process that dies mid-migration.
    for (const conn of this.lockConns.values()) conn.release();
    this.lockConns.clear();
    if (this.pool && !this.options.pool) await this.pool.end();
    this.pool = null;
  }

  // --- Advisory locks ---
  /**
   * `GET_LOCK(name, 0)` — try once and answer, never block. This is what lets the shared migration
   * runner serialize a concurrent first boot on MySQL: without it, N instances starting against a
   * fresh database all ran the full DDL at the same time, surviving only because `v1` is
   * `IF NOT EXISTS`-guarded throughout.
   *
   * MySQL lock names are capped at 64 characters, and the key is a table prefix plus a word, so it
   * is passed through as-is rather than hashed — a readable name in `performance_schema` is worth
   * more than the few bytes.
   */
  async tryAdvisoryLock(options: { key: string }): Promise<boolean> {
    if (!this.pool) return false;
    if (this.lockConns.has(options.key)) return true; // already held by this driver
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.query('SELECT GET_LOCK(?, 0) AS locked', [lockName(options.key)]);
      const locked = (rows as Array<{ locked?: unknown }>)[0]?.locked;
      // 1 = taken, 0 = held elsewhere, NULL = the attempt itself failed.
      if (Number(locked) !== 1) {
        conn.release();
        return false;
      }
      this.lockConns.set(options.key, conn);
      return true;
    } catch (err) {
      conn.release();
      throw err;
    }
  }

  async releaseAdvisoryLock(options: { key: string }): Promise<void> {
    const conn = this.lockConns.get(options.key);
    if (!conn) return;
    this.lockConns.delete(options.key);
    try {
      await conn.query('SELECT RELEASE_LOCK(?)', [lockName(options.key)]);
    } finally {
      conn.release();
    }
  }

  private toRaw(result: unknown): RawResult {
    if (Array.isArray(result)) {
      const rows = result as Array<Record<string, unknown>>;
      return { rows, rowCount: rows.length };
    }
    const ok = (result ?? {}) as MysqlOkPacket;
    return { rows: [], rowCount: ok.affectedRows ?? 0 };
  }

  protected async execute(
    sql: string,
    params: readonly unknown[],
    session?: Session,
  ): Promise<RawResult> {
    const target = (session as MysqlConnection | undefined) ?? this.pool;
    if (!target) throw new DriverConnectionError('MySQL driver is not connected.');
    const [result] = await target.query(sql, params);
    return this.toRaw(result);
  }

  protected async transaction<T>(fn: (session: Session) => Promise<T>): Promise<T> {
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

  /** MySQL uses `?` positional placeholders. */
  protected ph(_index0: number): string {
    return '?';
  }

  /**
   * The trailing `LIMIT`/`OFFSET` for a list read, appending each bound value to `params`.
   * Returns an empty string when the caller asked for no window.
   */
  protected window(page: PageWindow, params: unknown[]): string {
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

  /**
   * The applied schema version, or null when the migration table (or its database) does not exist
   * yet. Only those two conditions read as "not migrated": a dropped connection or a permissions
   * error has to surface rather than trigger a migration run against a migrated database.
   */
  async getSchemaVersion(): Promise<number | null> {
    try {
      const res = await this.execute(
        `SELECT MAX(${MigrationColumn.VERSION}) AS v FROM ${this.t(TableName.MIGRATION)}`,
        [],
      );
      const v = res.rows[0]?.v;
      return v == null ? null : Number(v);
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (typeof code === 'string' && MYSQL_MISSING_OBJECT.has(code)) return null;
      throw new DriverQueryError('Failed to read the applied schema version.', err);
    }
  }

  /**
   * Apply one migration's DDL, then record its version.
   *
   * MySQL commits DDL implicitly, so — unlike every other engine here — these cannot share one
   * transaction. That is safe because every statement in the migration is `IF NOT EXISTS`: a crash
   * between the DDL and the version row leaves a schema the next run re-applies as a no-op and then
   * records. The version insert is `INSERT IGNORE` for the same reason.
   */
  /**
   * Apply one step, then record it — **not** in one transaction, and it cannot be: MySQL commits each DDL statement implicitly, so no transaction can span them. A `BEGIN`
   * around them would be silently discarded at the first `CREATE TABLE`.
   *
   * What holds instead: every statement in this engine's migrations is idempotent, so an
   * interruption between the DDL and the version insert is repaired by re-running the step, and the
   * shared `MigrationRunner` reads the version back before it attempts the next one rather than
   * assuming this landed. The DDL runs *first* on purpose — a version recorded for statements that
   * never ran would make the next start skip them for good.
   */
  async applyMigration(options: { migration: MigrationStep }): Promise<void> {
    const statements = options.migration.statements(this.context);
    for (const sql of statements) await this.execute(sql, []);
    const now = Date.now();
    await this.execute(
      `INSERT IGNORE INTO ${this.t(TableName.MIGRATION)} (${MigrationColumn.VERSION}, ${MigrationColumn.CREATED_AT}, ${MigrationColumn.UPDATED_AT}) ` +
        `VALUES (${this.phList(3)})`,
      [options.migration.version, now, now],
    );
  }

  // --- Producing ---
  async insertJob(options: { job: NewJobRecord; tx?: TransactionHandle }): Promise<InsertedJobRow> {
    const [result] = await this.insertJobs({
      jobs: [options.job],
      ...(options.tx ? { tx: options.tx } : {}),
    });
    return result!;
  }

  /**
   * A real batch insert: one grouped dedup lookup per distinct queue, then a single multi-row
   * `INSERT`, both in one transaction. Nothing is read back — with no `RETURNING`, the id, status
   * and `start_after` of a fresh row are exactly what was written.
   */
  async insertJobs(options: {
    jobs: NewJobRecord[];
    tx?: TransactionHandle;
  }): Promise<InsertedJobRow[]> {
    const { jobs, tx } = options;
    if (!jobs.length) return [];
    return this.inTx(tx, async (run) => {
      await this.lockQueuesForDedup(run, jobs);
      const deduped = await this.findDeduplicated(jobs, run);
      const results = new Array<InsertedJobRow | undefined>(jobs.length);
      const fresh: Array<{ index: number; id: string; values: unknown[] }> = [];

      for (const [index, job] of jobs.entries()) {
        const hit = deduped.get(job);
        if (hit) {
          results[index] = hit;
          continue;
        }
        const { id, values } = this.jobInsertValues(job);
        fresh.push({ index, id, values });
      }

      // Chunked so one statement never exceeds the engine's bound-parameter limit; each chunk is
      // still a single multi-row insert.
      for (const chunk of this.chunkForBind(fresh, JOB_COLUMNS.length)) {
        if (!chunk.length) continue;
        const params: unknown[] = [];
        const tuples = chunk.map(({ values }) => {
          const placeholders = this.phList(values.length, params.length);
          params.push(...values);
          return `(${placeholders})`;
        });
        try {
          await run(
            `INSERT INTO ${this.t(TableName.JOB)} (${JOB_COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}`,
            params,
          );
        } catch (err) {
          throw new DriverQueryError(
            `Failed to insert ${chunk.length} job(s) on queue '${jobs[chunk[0]!.index]!.queueName}'.`,
            err,
          );
        }
        for (const { index, id } of chunk) {
          const job = jobs[index]!;
          results[index] = {
            id,
            status: job.status,
            startAfter: job.startAfter,
            deduplicated: false,
          };
        }
      }
      return results as InsertedJobRow[];
    });
  }

  /**
   * Locate the existing jobs that dedup this batch, in one lookup per distinct queue and key kind
   * rather than two per job. No unique index enforces either key — dedup lives in code so every
   * engine behaves identically and a duplicate returns the existing job instead of raising.
   */
  /**
   * Serialize the dedup-lookup-then-insert pair against another producer's, per queue.
   *
   * Only called when a batch actually carries an idempotency or singleton key. Without it the pair is
   * a read-then-write under `READ COMMITTED`: two concurrent `addJob`s with the same key both see no
   * row and both insert, and the dedup silently fails. Locking the **queue row** — which every keyed
   * insert on that queue must take — closes it with no schema change and no uniqueness constraint
   * that a singleton's status predicate could not express anyway. A queue with no keyed jobs never
   * pays for it, and a queue whose row does not exist yet locks nothing, which is no worse than
   * before.
   */
  private async lockQueuesForDedup(
    run: (sql: string, params: readonly unknown[]) => Promise<RawResult>,
    jobs: NewJobRecord[],
  ): Promise<void> {
    const names = [
      ...new Set(
        jobs.flatMap((j) =>
          j.idempotencyKey != null || j.singletonKey != null ? [j.queueName] : [],
        ),
      ),
    ].sort(); // a stable order, so two batches over the same queues cannot deadlock each other
    if (!names.length) return;
    await run(
      `SELECT ${QueueColumn.NAME} FROM ${this.t(TableName.QUEUE)} ` +
        `WHERE ${QueueColumn.NAME} IN (${this.phList(names.length)}) FOR UPDATE`,
      names,
    );
  }

  private async findDeduplicated(
    jobs: NewJobRecord[],
    run: (sql: string, params: readonly unknown[]) => Promise<RawResult>,
  ): Promise<Map<NewJobRecord, InsertedJobRow>> {
    const out = new Map<NewJobRecord, InsertedJobRow>();
    const cols = `${JobColumn.ID}, ${JobColumn.STATUS}, ${JobColumn.START_AFTER}`;

    const byQueue = new Map<string, NewJobRecord[]>();
    for (const job of jobs) {
      if (job.idempotencyKey == null && job.singletonKey == null) continue;
      const list = byQueue.get(job.queueName);
      if (list) list.push(job);
      else byQueue.set(job.queueName, [job]);
    }

    for (const [queueName, queueJobs] of byQueue) {
      const idemKeys = [
        ...new Set(queueJobs.flatMap((j) => (j.idempotencyKey ? [j.idempotencyKey] : []))),
      ];
      if (idemKeys.length) {
        const res = await run(
          `SELECT ${cols}, ${JobColumn.IDEMPOTENCY_KEY} FROM ${this.t(TableName.JOB)} ` +
            `WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.IDEMPOTENCY_KEY} IN (${this.phList(idemKeys.length, 1)})`,
          [queueName, ...idemKeys],
        );
        const found = new Map(res.rows.map((r) => [String(r[JobColumn.IDEMPOTENCY_KEY]), r]));
        for (const job of queueJobs) {
          if (job.idempotencyKey == null) continue;
          const row = found.get(job.idempotencyKey);
          if (row) out.set(job, this.dedupResult(row, DeduplicationReason.IDEMPOTENCY));
        }
      }

      const singletonKeys = [
        ...new Set(
          queueJobs.flatMap((j) => (!out.has(j) && j.singletonKey ? [j.singletonKey] : [])),
        ),
      ];
      if (singletonKeys.length) {
        const res = await run(
          `SELECT ${cols}, ${JobColumn.SINGLETON_KEY} FROM ${this.t(TableName.JOB)} ` +
            `WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.SINGLETON_KEY} IN (${this.phList(singletonKeys.length, 1)}) ` +
            `AND ${JobColumn.STATUS} IN (${this.phList(ACTIVE_STATUSES.length, 1 + singletonKeys.length)})`,
          [queueName, ...singletonKeys, ...ACTIVE_STATUSES],
        );
        const found = new Map(res.rows.map((r) => [String(r[JobColumn.SINGLETON_KEY]), r]));
        for (const job of queueJobs) {
          if (out.has(job) || job.singletonKey == null) continue;
          const row = found.get(job.singletonKey);
          if (row) out.set(job, this.dedupResult(row, DeduplicationReason.SINGLETON));
        }
      }
    }
    return out;
  }

  /** Shape a dedup hit the way `insertJob`'s caller reports it. */
  private dedupResult(row: Row, reason: DeduplicationReason): InsertedJobRow {
    return {
      id: String(row[JobColumn.ID]),
      status: row[JobColumn.STATUS] as JobStatus,
      startAfter: Number(row[JobColumn.START_AFTER]),
      deduplicated: true,
      deduplicationReason: reason,
    };
  }

  async findJobByIdempotencyKey(options: {
    queueName: string;
    idempotencyKey: string;
    tx?: TransactionHandle;
  }): Promise<InsertedJobRow | null> {
    const res = await this.runMaybeTx(
      `SELECT ${JobColumn.ID}, ${JobColumn.STATUS}, ${JobColumn.START_AFTER} FROM ${this.t(TableName.JOB)} ` +
        `WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.IDEMPOTENCY_KEY} = ${this.ph(1)}`,
      [options.queueName, options.idempotencyKey],
      options.tx,
    );
    return res.rows[0] ? this.dedupResult(res.rows[0], DeduplicationReason.IDEMPOTENCY) : null;
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

  async insertSchedule(options: {
    schedule: NewScheduleRow;
    tx?: TransactionHandle;
  }): Promise<ScheduleRow> {
    // Plain INSERT — NOT an UPSERT and no pattern-based dedup. No RETURNING on MySQL, so insert then
    // read the row back by its known id, in one transaction.
    const { id, values } = this.scheduleInsertValues(options.schedule, Date.now());
    return this.inTx(options.tx, async (run) => {
      await run(
        `INSERT INTO ${this.t(TableName.SCHEDULE)} (${SCHEDULE_INSERT_COLUMNS.join(', ')}) ` +
          `VALUES (${this.phList(values.length)})`,
        values,
      );
      const res = await run(
        `SELECT * FROM ${this.t(TableName.SCHEDULE)} WHERE ${ScheduleColumn.ID} = ${this.ph(0)}`,
        [id],
      );
      if (!res.rows[0]) throw new DriverQueryError(`Failed to insert schedule '${id}'.`);
      return this.mapSchedule(res.rows[0]);
    });
  }

  async deleteSchedule(options: {
    scheduleId: string;
    tx?: TransactionHandle;
  }): Promise<ScheduleRef | null> {
    const [ref] = await this.deleteSchedules({
      scheduleIds: [options.scheduleId],
      ...(options.tx ? { tx: options.tx } : {}),
    });
    return ref ?? null;
  }

  async deleteSchedules(options: {
    scheduleIds: string[];
    tx?: TransactionHandle;
  }): Promise<ScheduleRef[]> {
    if (!options.scheduleIds.length) return [];
    // Chunked so one statement can never carry more ids than the engine allows in an
    // `IN (...)` list. A capped batch is a single chunk, and so a single statement.
    return this.overIdChunks(options.scheduleIds, async (scheduleIds) => {
      // No RETURNING: lock and read the rows, then delete exactly those ids in one statement.
      return this.inTx(options.tx, async (run) => {
        const sel = await run(
          `SELECT ${ScheduleColumn.ID}, ${ScheduleColumn.QUEUE_NAME} FROM ${this.t(TableName.SCHEDULE)} ` +
            `WHERE ${ScheduleColumn.ID} IN (${this.phList(scheduleIds.length)}) FOR UPDATE`,
          scheduleIds,
        );
        const refs = sel.rows.map((r) => this.mapScheduleRef(r));
        if (!refs.length) return [];
        const ids = refs.map((r) => r.scheduleId);
        await run(
          `DELETE FROM ${this.t(TableName.SCHEDULE)} WHERE ${ScheduleColumn.ID} IN (${this.phList(ids.length)})`,
          ids,
        );
        return refs;
      });
    });
  }

  async setScheduleEnabled(options: {
    scheduleId: string;
    enabled: boolean;
    now: number;
    tx?: TransactionHandle;
  }): Promise<ScheduleRef | null> {
    return this.inTx(options.tx, async (run) => {
      const sel = await run(
        `SELECT ${ScheduleColumn.ID}, ${ScheduleColumn.QUEUE_NAME} FROM ${this.t(TableName.SCHEDULE)} ` +
          `WHERE ${ScheduleColumn.ID} = ${this.ph(0)} FOR UPDATE`,
        [options.scheduleId],
      );
      if (!sel.rows[0]) return null;
      await run(
        `UPDATE ${this.t(TableName.SCHEDULE)} SET ${ScheduleColumn.ENABLED} = ${this.ph(0)}, ` +
          `${ScheduleColumn.UPDATED_AT} = ${this.ph(1)} WHERE ${ScheduleColumn.ID} = ${this.ph(2)}`,
        [this.boolIn(options.enabled), options.now, options.scheduleId],
      );
      return this.mapScheduleRef(sel.rows[0]);
    });
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
    const lockedUntil = this.lockDeadline(now, lockDurationSeconds);
    // One token per claim call: every row this claim takes carries it, and every completion is
    // fenced on it (see `claimFence`). A later claim of the same row writes a different one.
    const lockToken = this.newId();

    // Select claimable ids highest-priority-first, locking them for the transaction with SKIP
    // LOCKED so concurrent claimers never contend, then update exactly those and read them back —
    // the three steps MySQL's lack of RETURNING forces. Affinity is a regex, which SQL cannot
    // evaluate, so a named instance pages and filters in the tool.
    return this.transaction(async (session) => {
      const ids: string[] = [];
      if (!instanceKey) {
        const sel = await this.execute(
          `SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} ` +
            `WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.STATUS} IN (${this.ph(1)}, ${this.ph(2)}) ` +
            `AND ${JobColumn.START_AFTER} <= ${this.ph(3)} AND (${JobColumn.EXPIRE_AT} IS NULL OR ${JobColumn.EXPIRE_AT} > ${this.ph(4)}) ` +
            `ORDER BY ${JobColumn.PRIORITY} DESC, ${JobColumn.START_AFTER} ASC LIMIT ${this.ph(5)} FOR UPDATE SKIP LOCKED`,
          [queueName, JobStatus.PENDING, JobStatus.RETRY, now, now, limit],
          session,
        );
        for (const row of sel.rows) ids.push(String(row[JobColumn.ID]));
      } else {
        const { pageSize, maxScan } = this.affinityPlan(limit);
        const matched = new Set<string>();
        for (let offset = 0; matched.size < limit && offset < maxScan; offset += pageSize) {
          const sel = await this.execute(
            `SELECT ${JobColumn.ID}, ${JobColumn.PREFERRED_INSTANCE_KEY_PATTERN} FROM ${this.t(TableName.JOB)} ` +
              `WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.STATUS} IN (${this.ph(1)}, ${this.ph(2)}) ` +
              `AND ${JobColumn.START_AFTER} <= ${this.ph(3)} AND (${JobColumn.EXPIRE_AT} IS NULL OR ${JobColumn.EXPIRE_AT} > ${this.ph(4)}) ` +
              `ORDER BY ${JobColumn.PRIORITY} DESC, ${JobColumn.START_AFTER} ASC ` +
              `LIMIT ${this.ph(5)} OFFSET ${this.ph(6)} FOR UPDATE SKIP LOCKED`,
            [queueName, JobStatus.PENDING, JobStatus.RETRY, now, now, pageSize, offset],
            session,
          );
          if (sel.rows.length === 0) break;
          this.collectAffinityMatches(sel.rows, instanceKey, limit, matched);
          if (sel.rows.length < pageSize) break;
        }
        ids.push(...matched);
      }
      if (ids.length === 0) return [];

      const head = [JobStatus.ACTIVE, now, lockedUntil, lockToken, instanceKey ?? null, now];
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.STARTED_AT} = ${this.ph(1)}, ` +
          `${JobColumn.LOCKED_UNTIL} = ${this.ph(2)}, ${JobColumn.LOCK_TOKEN} = ${this.ph(3)}, ` +
          `${JobColumn.PROCESSED_ON_INSTANCE_KEY} = ${this.ph(4)}, ${JobColumn.UPDATED_AT} = ${this.ph(5)} ` +
          `WHERE ${JobColumn.ID} IN (${this.phList(ids.length, head.length)}) ` +
          `AND ${JobColumn.STATUS} IN (${this.ph(head.length + ids.length)}, ${this.ph(head.length + ids.length + 1)})`,
        [...head, ...ids, JobStatus.PENDING, JobStatus.RETRY],
        session,
      );
      // Read back only the rows this call actually claimed: the ones carrying *this* claim's token.
      // A row another claimer took first has a token of its own and is excluded.
      const res = await this.execute(
        `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} ` +
          `WHERE ${JobColumn.ID} IN (${this.phList(ids.length)}) AND ${JobColumn.LOCK_TOKEN} = ${this.ph(ids.length)}`,
        [...ids, lockToken],
        session,
      );
      return this.sortClaimed(res.rows.map((r) => this.mapJob(r)));
    });
  }

  /**
   * The fence a completion is guarded on: the row must still be `ACTIVE` and, when the caller names
   * the claim it is settling, still carry that claim's token.
   *
   * Status alone is not enough. A lapsed lock is reclaimed and the row claimed again, so it reads
   * `ACTIVE` once more — and a handler from the first run that ignored its abort signal would write
   * its outcome over the second run's. The token identifies the claim itself, so a stale completion
   * matches nothing and reports "not settled" instead.
   */
  private claimFence(params: unknown[], lockToken: string | null | undefined): string {
    let sql = ` AND ${JobColumn.STATUS} = ${this.ph(params.length)}`;
    params.push(JobStatus.ACTIVE);
    if (lockToken != null) {
      sql += ` AND ${JobColumn.LOCK_TOKEN} = ${this.ph(params.length)}`;
      params.push(lockToken);
    }
    return sql;
  }

  async extendLock(options: {
    jobId: string;
    lockDurationSeconds: number;
    now: number;
    lockToken?: string | null;
  }): Promise<boolean> {
    const params: unknown[] = [
      this.lockDeadline(options.now, options.lockDurationSeconds),
      options.now,
      options.jobId,
    ];
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.LOCKED_UNTIL} = ${this.ph(0)}, ${JobColumn.UPDATED_AT} = ${this.ph(1)} ` +
        `WHERE ${JobColumn.ID} = ${this.ph(2)}${this.claimFence(params, options.lockToken)}`,
      params,
    );
    return res.rowCount > 0;
  }

  async completeJob(options: {
    jobId: string;
    returnValue?: unknown;
    now: number;
    lockToken?: string | null;
    tx?: TransactionHandle;
  }): Promise<boolean> {
    const params: unknown[] = [
      JobStatus.COMPLETED,
      this.toJson(options.returnValue),
      options.now,
      options.now,
      options.jobId,
    ];
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.RETURN_VALUE} = ${this.ph(1)}, ` +
        `${JobColumn.COMPLETED_AT} = ${this.ph(2)}, ${JobColumn.UPDATED_AT} = ${this.ph(3)}, ${JobColumn.LOCKED_UNTIL} = NULL, ${JobColumn.LOCK_TOKEN} = NULL ` +
        `WHERE ${JobColumn.ID} = ${this.ph(4)}${this.claimFence(params, options.lockToken)}`,
      params,
      options.tx,
    );
    return res.rowCount > 0;
  }

  async retryJob(options: {
    jobId: string;
    nextRunAt: number;
    retryAttempt: number;
    lastError: string;
    now: number;
    lockToken?: string | null;
  }): Promise<boolean> {
    const params: unknown[] = [
      JobStatus.RETRY,
      options.retryAttempt,
      options.nextRunAt,
      options.now,
      options.lastError,
      options.now,
      options.jobId,
    ];
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.RETRY_ATTEMPT} = ${this.ph(1)}, ` +
        `${JobColumn.START_AFTER} = ${this.ph(2)}, ${JobColumn.RETRIED_AT} = ${this.ph(3)}, ${JobColumn.FAILURE_MESSAGE} = ${this.ph(4)}, ` +
        `${JobColumn.UPDATED_AT} = ${this.ph(5)}, ${JobColumn.LOCKED_UNTIL} = NULL, ${JobColumn.LOCK_TOKEN} = NULL ` +
        `WHERE ${JobColumn.ID} = ${this.ph(6)}${this.claimFence(params, options.lockToken)}`,
      params,
    );
    return res.rowCount > 0;
  }

  async failJob(options: {
    jobId: string;
    lastError: string;
    now: number;
    lockToken?: string | null;
  }): Promise<boolean> {
    const params: unknown[] = [
      JobStatus.FAILED,
      options.now,
      options.lastError,
      options.now,
      options.jobId,
    ];
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.FAILED_AT} = ${this.ph(1)}, ` +
        `${JobColumn.FAILURE_MESSAGE} = ${this.ph(2)}, ${JobColumn.UPDATED_AT} = ${this.ph(3)}, ${JobColumn.LOCKED_UNTIL} = NULL, ${JobColumn.LOCK_TOKEN} = NULL ` +
        `WHERE ${JobColumn.ID} = ${this.ph(4)}${this.claimFence(params, options.lockToken)}`,
      params,
    );
    return res.rowCount > 0;
  }

  async reclaimStalledJobs(options: {
    queueName?: string;
    limit: number;
    now: number;
  }): Promise<StalledJobRef[]> {
    // Bounded, and only three columns: the caller needs the id, the queue to wake, and who held it.
    const params: unknown[] = [JobStatus.ACTIVE, options.now];
    let where =
      `${JobColumn.STATUS} = ${this.ph(0)} AND ${JobColumn.LOCKED_UNTIL} IS NOT NULL ` +
      `AND ${JobColumn.LOCKED_UNTIL} < ${this.ph(1)}`;
    if (options.queueName) {
      where += ` AND ${JobColumn.QUEUE_NAME} = ${this.ph(params.length)}`;
      params.push(options.queueName);
    }
    const limitPh = this.ph(params.length);
    params.push(options.limit);
    return this.transaction(async (session) => {
      const sel = await this.execute(
        `SELECT ${JobColumn.ID}, ${JobColumn.QUEUE_NAME}, ${JobColumn.PROCESSED_ON_INSTANCE_KEY} ` +
          `FROM ${this.t(TableName.JOB)} WHERE ${where} LIMIT ${limitPh} FOR UPDATE SKIP LOCKED`,
        params,
        session,
      );
      if (!sel.rows.length) return [];
      const refs = sel.rows.map((r) => ({
        ...this.mapJobRef(r),
        previousInstanceKey: this.strOrNull(r[JobColumn.PROCESSED_ON_INSTANCE_KEY]),
      }));
      const ids = refs.map((r) => r.jobId);
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.STALLED_AT} = ${this.ph(1)}, ` +
          `${JobColumn.LOCKED_UNTIL} = NULL, ${JobColumn.LOCK_TOKEN} = NULL WHERE ${JobColumn.ID} IN (${this.phList(ids.length, 2)})`,
        [JobStatus.PENDING, options.now, ...ids],
        session,
      );
      return refs;
    });
  }

  async expireDueJobs(options: {
    queueName?: string;
    limit: number;
    now: number;
  }): Promise<JobRef[]> {
    const params: unknown[] = [JobStatus.PENDING, JobStatus.RETRY, options.now];
    let where =
      `${JobColumn.STATUS} IN (${this.ph(0)}, ${this.ph(1)}) AND ${JobColumn.EXPIRE_AT} IS NOT NULL ` +
      `AND ${JobColumn.EXPIRE_AT} <= ${this.ph(2)}`;
    if (options.queueName) {
      where += ` AND ${JobColumn.QUEUE_NAME} = ${this.ph(params.length)}`;
      params.push(options.queueName);
    }
    const limitPh = this.ph(params.length);
    params.push(options.limit);
    return this.transaction(async (session) => {
      const sel = await this.execute(
        `SELECT ${JobColumn.ID}, ${JobColumn.QUEUE_NAME} FROM ${this.t(TableName.JOB)} ` +
          `WHERE ${where} LIMIT ${limitPh} FOR UPDATE SKIP LOCKED`,
        params,
        session,
      );
      if (!sel.rows.length) return [];
      const refs = sel.rows.map((r) => this.mapJobRef(r));
      const ids = refs.map((r) => r.jobId);
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.EXPIRED_AT} = ${this.ph(1)}, ` +
          `${JobColumn.UPDATED_AT} = ${this.ph(2)}, ${JobColumn.LOCKED_UNTIL} = NULL, ${JobColumn.LOCK_TOKEN} = NULL ` +
          `WHERE ${JobColumn.ID} IN (${this.phList(ids.length, 3)})`,
        [JobStatus.EXPIRED, options.now, options.now, ...ids],
        session,
      );
      return refs;
    });
  }

  async requeueJob(options: {
    jobId: string;
    now: number;
    tx?: TransactionHandle;
  }): Promise<RequeuedJobRef | null> {
    const [ref] = await this.requeueJobs({
      jobIds: [options.jobId],
      now: options.now,
      ...(options.tx ? { tx: options.tx } : {}),
    });
    return ref ?? null;
  }

  async requeueJobs(options: {
    jobIds: string[];
    now: number;
    tx?: TransactionHandle;
  }): Promise<RequeuedJobRef[]> {
    if (!options.jobIds.length) return [];
    // Chunked so one statement can never carry more ids than the engine allows in an
    // `IN (...)` list. A capped batch is a single chunk, and so a single statement.
    return this.overIdChunks(options.jobIds, async (jobIds) => {
      // Guarded on `status != ACTIVE`. Re-arming a running job would clear its lock and let a second
      // worker claim it while the first handler is still going. An ACTIVE or missing id is simply not
      // re-armed, so a batch never fails on one stale id.
      return this.inTx(options.tx, async (run) => {
        const sel = await run(
          `SELECT ${JobColumn.ID}, ${JobColumn.QUEUE_NAME} FROM ${this.t(TableName.JOB)} ` +
            `WHERE ${JobColumn.ID} IN (${this.phList(jobIds.length)}) ` +
            `AND ${JobColumn.STATUS} <> ${this.ph(jobIds.length)} FOR UPDATE`,
          [...jobIds, JobStatus.ACTIVE],
        );
        if (!sel.rows.length) return [];
        const refs = sel.rows.map((r) => this.mapJobRef(r));
        const ids = refs.map((r) => r.jobId);
        const head: unknown[] = [JobStatus.PENDING, options.now, options.now];
        await run(
          `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.RETRY_ATTEMPT} = 0, ` +
            `${JobColumn.START_AFTER} = ${this.ph(1)}, ${JobColumn.FAILED_AT} = NULL, ${JobColumn.FAILURE_MESSAGE} = NULL, ` +
            `${JobColumn.COMPLETED_AT} = NULL, ${JobColumn.STARTED_AT} = NULL, ${JobColumn.CANCELLED_AT} = NULL, ` +
            `${JobColumn.EXPIRED_AT} = NULL, ${JobColumn.RETURN_VALUE} = NULL, ${JobColumn.RETRIED_AT} = NULL, ${JobColumn.STALLED_AT} = NULL, ${JobColumn.LOCKED_UNTIL} = NULL, ${JobColumn.LOCK_TOKEN} = NULL, ` +
            `${JobColumn.UPDATED_AT} = ${this.ph(2)} WHERE ${JobColumn.ID} IN (${this.phList(ids.length, head.length)})`,
          [...head, ...ids],
        );
        return refs.map((ref) => ({ ...ref, status: JobStatus.PENDING, startAfter: options.now }));
      });
    });
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
   * `countJobs` so a page and its total can never disagree about what they select. `search` is
   * matched in SQL across the five fields an operator triages by, so a text query pages in the
   * database instead of streaming the table into the process.
   */
  private jobFilterClauses(options: JobListFilter, params: unknown[]): string {
    const clauses: string[] = [];
    if (options.queueName) {
      clauses.push(`${JobColumn.QUEUE_NAME} = ${this.ph(params.length)}`);
      params.push(options.queueName);
    }
    if (options.statuses && options.statuses.length) {
      clauses.push(
        `${JobColumn.STATUS} IN (${this.phList(options.statuses.length, params.length)})`,
      );
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
    if (options.search) {
      const pattern = this.likePattern(options.search);
      const cols = [
        JobColumn.ID,
        JobColumn.STATUS,
        JobColumn.IDEMPOTENCY_KEY,
        JobColumn.FAILURE_MESSAGE,
        JobColumn.DATA,
      ];
      const ors = cols.map((col) => {
        const clause = `LOWER(${col}) LIKE ${this.ph(params.length)} ESCAPE '!'`;
        params.push(pattern);
        return clause;
      });
      clauses.push(`(${ors.join(' OR ')})`);
    }
    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  }

  async getJobs(options: JobListFilter & { limit: number; offset: number }): Promise<JobRecord[]> {
    const params: unknown[] = [];
    const where = this.jobFilterClauses(options, params);
    const res = await this.runMaybeTx(
      `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} ${where} ` +
        `ORDER BY ${JobColumn.CREATED_AT} DESC` +
        this.window(options, params),
      params,
    );
    return res.rows.map((r) => this.mapJob(r));
  }

  async countJobs(options: JobListFilter): Promise<number> {
    const params: unknown[] = [];
    const where = this.jobFilterClauses(options, params);
    const res = await this.runMaybeTx(
      `SELECT COUNT(*) AS c FROM ${this.t(TableName.JOB)} ${where}`,
      params,
    );
    return Number(res.rows[0]?.c ?? 0);
  }

  async countJobsByStatus(options: {
    queueName?: string;
    processedOnInstanceKey?: string;
  }): Promise<Record<JobStatus, number>> {
    const params: unknown[] = [];
    const where = this.jobFilterClauses(options, params);
    const res = await this.runMaybeTx(
      `SELECT ${JobColumn.STATUS}, COUNT(*) AS c FROM ${this.t(TableName.JOB)} ${where} GROUP BY ${JobColumn.STATUS}`,
      params,
    );
    const counts = this.emptyStatusCounts();
    for (const row of res.rows) counts[row[JobColumn.STATUS] as JobStatus] = Number(row.c);
    return counts;
  }

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
    for (const key of keys) out[key] = this.emptyStatusCounts();
    if (!keys.length) return out;
    // Chunked like every other key list: the instances page can ask about more keys than an engine
    // will take in one `IN (...)`, and each chunk fills its own share of the same result.
    await this.overIdChunks(keys, async (chunk) => {
      const res = await this.runMaybeTx(
        `SELECT ${keyColumn}, ${JobColumn.STATUS}, COUNT(*) AS c FROM ${this.t(TableName.JOB)} ` +
          `WHERE ${keyColumn} IN (${this.phList(chunk.length)}) GROUP BY ${keyColumn}, ${JobColumn.STATUS}`,
        chunk,
      );
      for (const row of res.rows) {
        const bucket = out[String(row[keyColumn])];
        if (bucket) bucket[row[JobColumn.STATUS] as JobStatus] = Number(row.c);
      }
      return res.rows;
    });
    return out;
  }

  /** WHERE clauses for a queue-list filter, appending each value to `params`. */
  private queueFilterClauses(options: QueueListFilter, params: unknown[]): string {
    const clauses: string[] = [];
    if (options.search) {
      clauses.push(`LOWER(${QueueColumn.NAME}) LIKE ${this.ph(params.length)} ESCAPE '!'`);
      params.push(this.likePattern(options.search));
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
    // `name` is the primary key, so a page can no longer contain the same queue twice.
    const res = await this.runMaybeTx(
      `SELECT * FROM ${this.t(TableName.QUEUE)} ${where} ORDER BY ${QueueColumn.NAME} ASC` +
        this.window(options, params),
      params,
    );
    return res.rows.map((r) => this.mapQueue(r));
  }

  async countQueues(options: QueueListFilter = {}): Promise<number> {
    const params: unknown[] = [];
    const where = this.queueFilterClauses(options, params);
    const res = await this.runMaybeTx(
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
      const pattern = this.likePattern(options.search);
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
    const res = await this.runMaybeTx(
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
    const res = await this.runMaybeTx(
      `SELECT COUNT(*) AS c FROM ${this.t(TableName.SCHEDULE)} ${where}`,
      params,
    );
    return Number(res.rows[0]?.c ?? 0);
  }

  async getSchedule(options: { scheduleId: string }): Promise<ScheduleRow | null> {
    const res = await this.runMaybeTx(
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} WHERE ${ScheduleColumn.ID} = ${this.ph(0)}`,
      [options.scheduleId],
    );
    return res.rows[0] ? this.mapSchedule(res.rows[0]) : null;
  }

  async getDueSchedules(options: { now: number; limit: number }): Promise<ScheduleRow[]> {
    const res = await this.runMaybeTx(
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} WHERE ${ScheduleColumn.ENABLED} = ${this.ph(0)} ` +
        `AND ${ScheduleColumn.NEXT_RUN_AT} IS NOT NULL AND ${ScheduleColumn.NEXT_RUN_AT} <= ${this.ph(1)} ` +
        `ORDER BY ${ScheduleColumn.NEXT_RUN_AT} ASC LIMIT ${this.ph(2)}`,
      [this.boolIn(true), options.now, options.limit],
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
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.SCHEDULE)} SET ${ScheduleColumn.NEXT_RUN_AT} = ${this.ph(0)}, ` +
        `${ScheduleColumn.LAST_RUN_AT} = ${this.ph(1)}, ${ScheduleColumn.UPDATED_AT} = ${this.ph(2)} ` +
        `WHERE ${ScheduleColumn.ID} = ${this.ph(3)} AND ${ScheduleColumn.NEXT_RUN_AT} = ${this.ph(4)}`,
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
  }): Promise<JobRef | null> {
    const [ref] = await this.cancelJobs({
      jobIds: [options.jobId],
      now: options.now,
      ...(options.tx ? { tx: options.tx } : {}),
    });
    return ref ?? null;
  }

  async cancelJobs(options: {
    jobIds: string[];
    now: number;
    tx?: TransactionHandle;
  }): Promise<JobRef[]> {
    if (!options.jobIds.length) return [];
    // Chunked so one statement can never carry more ids than the engine allows in an
    // `IN (...)` list. A capped batch is a single chunk, and so a single statement.
    return this.overIdChunks(options.jobIds, async (jobIds) => {
      return this.inTx(options.tx, async (run) => {
        const sel = await run(
          `SELECT ${JobColumn.ID}, ${JobColumn.QUEUE_NAME} FROM ${this.t(TableName.JOB)} ` +
            `WHERE ${JobColumn.ID} IN (${this.phList(jobIds.length)}) ` +
            `AND ${JobColumn.STATUS} IN (${this.phList(2, jobIds.length)}) FOR UPDATE`,
          [...jobIds, JobStatus.PENDING, JobStatus.RETRY],
        );
        if (!sel.rows.length) return [];
        const refs = sel.rows.map((r) => this.mapJobRef(r));
        const ids = refs.map((r) => r.jobId);
        await run(
          `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.CANCELLED_AT} = ${this.ph(1)}, ` +
            `${JobColumn.UPDATED_AT} = ${this.ph(2)}, ${JobColumn.LOCKED_UNTIL} = NULL, ${JobColumn.LOCK_TOKEN} = NULL ` +
            `WHERE ${JobColumn.ID} IN (${this.phList(ids.length, 3)})`,
          [JobStatus.CANCELLED, options.now, options.now, ...ids],
        );
        return refs;
      });
    });
  }

  async removeJob(options: { jobId: string; tx?: TransactionHandle }): Promise<JobRef | null> {
    const [ref] = await this.removeJobs({
      jobIds: [options.jobId],
      ...(options.tx ? { tx: options.tx } : {}),
    });
    return ref ?? null;
  }

  async removeJobs(options: { jobIds: string[]; tx?: TransactionHandle }): Promise<JobRef[]> {
    if (!options.jobIds.length) return [];
    // Chunked so one statement can never carry more ids than the engine allows in an
    // `IN (...)` list. A capped batch is a single chunk, and so a single statement.
    return this.overIdChunks(options.jobIds, async (jobIds) => {
      // Never delete a running job — an ACTIVE row belongs to a live handler, so it is skipped and
      // simply absent from the result; cancel it first.
      return this.inTx(options.tx, async (run) => {
        const sel = await run(
          `SELECT ${JobColumn.ID}, ${JobColumn.QUEUE_NAME} FROM ${this.t(TableName.JOB)} ` +
            `WHERE ${JobColumn.ID} IN (${this.phList(jobIds.length)}) ` +
            `AND ${JobColumn.STATUS} <> ${this.ph(jobIds.length)} FOR UPDATE`,
          [...jobIds, JobStatus.ACTIVE],
        );
        if (!sel.rows.length) return [];
        const refs = sel.rows.map((r) => this.mapJobRef(r));
        const ids = refs.map((r) => r.jobId);
        await run(
          `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} IN (${this.phList(ids.length)})`,
          ids,
        );
        return refs;
      });
    });
  }

  async removeJobsByStatus(options: {
    queueName: string;
    statuses: JobStatus[];
    tx?: TransactionHandle;
  }): Promise<number> {
    if (!options.statuses.length) return 0;
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.STATUS} IN (${this.phList(options.statuses.length)}) ` +
        `AND ${JobColumn.QUEUE_NAME} = ${this.ph(options.statuses.length)}`,
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
  }): Promise<QueueRow | null> {
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
    const namePh = this.ph(params.length);
    params.push(options.queueName);
    // No RETURNING: update, then read the row back in the same transaction.
    return this.inTx(options.tx, async (run) => {
      await run(
        `UPDATE ${this.t(TableName.QUEUE)} SET ${sets.join(', ')} WHERE ${QueueColumn.NAME} = ${namePh}`,
        params,
      );
      const res = await run(
        `SELECT * FROM ${this.t(TableName.QUEUE)} WHERE ${QueueColumn.NAME} = ${this.ph(0)}`,
        [options.queueName],
      );
      return res.rows[0] ? this.mapQueue(res.rows[0]) : null;
    });
  }

  async ensureQueue(options: {
    name: string;
    options?: QueueOptions;
    now: number;
    tx?: TransactionHandle;
  }): Promise<QueueRow> {
    // Get-or-create in one statement pair. `name` is the primary key, so `INSERT IGNORE` makes a
    // concurrent create a no-op rather than an error. Queue options are process-local; only the
    // pause flags are ever persisted, so an existing row is never rewritten from here.
    return this.inTx(options.tx, async (run) => {
      await run(
        `INSERT IGNORE INTO ${this.t(TableName.QUEUE)} (${QueueColumn.NAME}, ${QueueColumn.PROCESSING_PAUSED}, ` +
          `${QueueColumn.ACCEPTING_PAUSED}, ${QueueColumn.CREATED_AT}, ${QueueColumn.UPDATED_AT}) ` +
          `VALUES (${this.phList(5)})`,
        [options.name, this.boolIn(false), this.boolIn(false), options.now, options.now],
      );
      const res = await run(
        `SELECT * FROM ${this.t(TableName.QUEUE)} WHERE ${QueueColumn.NAME} = ${this.ph(0)}`,
        [options.name],
      );
      if (!res.rows[0]) throw new DriverQueryError(`Failed to ensure queue '${options.name}'.`);
      return this.mapQueue(res.rows[0]);
    });
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
    // Only removes the queue row. Jobs link by queue_name (no FK), so this never cascades.
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
    // Update-first, then insert only if the row is genuinely absent, then read it back — three
    // statements where PostgreSQL needs one, because MySQL has no RETURNING and reports an UPDATE that
    // changed nothing as zero rows affected. The read-back is what the caller takes
    // `processingPaused` from, so there is no query after this transaction. The pause flag is never
    // written here.
    const m = options.metrics;
    return this.inTx(undefined, async (run) => {
      await run(
        `UPDATE ${this.t(TableName.INSTANCE)} SET ${InstanceColumn.LAST_SEEN_AT} = ${this.ph(0)}, ` +
          `${InstanceColumn.UPDATED_AT} = ${this.ph(1)}, ` +
          `${InstanceColumn.CPU_PERCENT} = COALESCE(${this.ph(2)}, ${InstanceColumn.CPU_PERCENT}), ` +
          `${InstanceColumn.MEMORY_PERCENT} = COALESCE(${this.ph(3)}, ${InstanceColumn.MEMORY_PERCENT}) ` +
          `WHERE ${InstanceColumn.INSTANCE_KEY} = ${this.ph(4)}`,
        [
          options.now,
          options.now,
          m?.cpuPercent ?? null,
          m?.memoryPercent ?? null,
          options.instanceKey,
        ],
      );
      const read = async (): Promise<Row | undefined> => {
        const res = await run(
          `SELECT * FROM ${this.t(TableName.INSTANCE)} WHERE ${InstanceColumn.INSTANCE_KEY} = ${this.ph(0)}`,
          [options.instanceKey],
        );
        return res.rows[0];
      };
      let row = await read();
      if (!row) {
        await run(
          `INSERT IGNORE INTO ${this.t(TableName.INSTANCE)} (${InstanceColumn.INSTANCE_KEY}, ${InstanceColumn.PROCESSING_PAUSED}, ` +
            `${InstanceColumn.CREATED_AT}, ${InstanceColumn.UPDATED_AT}, ${InstanceColumn.LAST_SEEN_AT}, ` +
            `${InstanceColumn.CPU_PERCENT}, ${InstanceColumn.MEMORY_PERCENT}) VALUES (${this.phList(7)})`,
          [
            options.instanceKey,
            this.boolIn(false),
            options.now,
            options.now,
            options.now,
            m?.cpuPercent ?? null,
            m?.memoryPercent ?? null,
          ],
        );
        row = await read();
      }
      if (!row) {
        throw new DriverQueryError(`Failed to register instance '${options.instanceKey}'.`);
      }
      return this.mapInstance(row);
    });
  }

  /** WHERE clauses for an instance-list filter, appending each value to `params`. */
  private instanceFilterClauses(options: InstanceListFilter, params: unknown[]): string {
    const clauses: string[] = [];
    if (options.search) {
      clauses.push(
        `LOWER(${InstanceColumn.INSTANCE_KEY}) LIKE ${this.ph(params.length)} ESCAPE '!'`,
      );
      params.push(this.likePattern(options.search));
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
    const res = await this.runMaybeTx(
      `SELECT * FROM ${this.t(TableName.INSTANCE)} ${where} ORDER BY ${InstanceColumn.INSTANCE_KEY} ASC` +
        this.window(options, params),
      params,
    );
    return res.rows.map((r) => this.mapInstance(r));
  }

  async countInstances(options: InstanceListFilter = {}): Promise<number> {
    const params: unknown[] = [];
    const where = this.instanceFilterClauses(options, params);
    const res = await this.runMaybeTx(
      `SELECT COUNT(*) AS c FROM ${this.t(TableName.INSTANCE)} ${where}`,
      params,
    );
    return Number(res.rows[0]?.c ?? 0);
  }

  async getInstance(options: { instanceKey: string }): Promise<InstanceRow | null> {
    const res = await this.runMaybeTx(
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
    await this.runMaybeTx(
      `UPDATE ${this.t(TableName.INSTANCE)} SET ${InstanceColumn.PROCESSING_PAUSED} = ${this.ph(0)}, ` +
        `${InstanceColumn.UPDATED_AT} = ${this.ph(1)} WHERE ${InstanceColumn.INSTANCE_KEY} = ${this.ph(2)}`,
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
  async deleteFinishedJobs(options: { olderThan: number; limit: number }): Promise<number> {
    const params: unknown[] = [];
    const where = this.retentionWhere(options.olderThan, params);
    const limitPh = this.ph(params.length);
    params.push(options.limit);
    // MySQL rejects `LIMIT` inside an `IN` subquery but supports it directly on `DELETE`, so the
    // bounded batch is one statement rather than the select-then-delete pair other engines use.
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${where} LIMIT ${limitPh}`,
      params,
    );
    return res.rowCount;
  }

  /**
   * The retention predicate: a row that carries a TTL, in a status **its own policy** covers, whose
   * TTL has elapsed since it finished. A NULL `retention_ttl_seconds` is a job with no retention
   * policy at all and is never deleted. A row with a NULL `retention_statuses` is eligible in every
   * finished status (the default); a row that named a subset is eligible only in one of those.
   */
  private retentionWhere(olderThan: number, params: unknown[]): string {
    const statusPh = this.phList(FINISHED_STATUSES.length, params.length);
    params.push(...FINISHED_STATUSES);
    // One integer test per status rather than a leading-wildcard `LIKE`: the old encoding could not
    // use an index and cost four pattern matches per candidate row.
    const scoped = FINISHED_STATUSES.map((status) => {
      const clause =
        `(${JobColumn.STATUS} = ${this.ph(params.length)} AND ` +
        `${JobColumn.RETENTION_STATUSES} & ${this.ph(params.length + 1)} <> 0)`;
      params.push(status, retentionStatusBit(status));
      return clause;
    });
    const cutoffPh = this.ph(params.length);
    params.push(olderThan);
    return (
      `${JobColumn.RETENTION_TTL_SECONDS} IS NOT NULL ` +
      `AND ${JobColumn.STATUS} IN (${statusPh}) ` +
      `AND (${JobColumn.RETENTION_STATUSES} IS NULL OR ${scoped.join(' OR ')}) ` +
      `AND (COALESCE(${JobColumn.COMPLETED_AT}, ${JobColumn.FAILED_AT}, ${JobColumn.CANCELLED_AT}, ` +
      `${JobColumn.EXPIRED_AT}, ${JobColumn.UPDATED_AT}) + ${JobColumn.RETENTION_TTL_SECONDS} * ${MS_PER_SECOND}) <= ${cutoffPh}`
    );
  }

  // --- Pub/sub (interval polling instead of LISTEN/NOTIFY) ---
  async notify(_options: { channel: string; payload: string }): Promise<void> {
    // No-op: MySQL has no LISTEN/NOTIFY; subscribers rely on interval polling.
  }

  async subscribe(_options: {
    channel: string;
    onNotification: (payload: string) => void;
  }): Promise<Subscription> {
    throw new UnsupportedCapabilityError(
      DriverCapability.LISTEN_NOTIFY,
      'MySQL has no LISTEN/NOTIFY; use interval polling.',
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

/**
 * A lock name MySQL will accept: at most {@link MYSQL_LOCK_NAME_MAX} characters, so a long table
 * prefix cannot produce a name the server truncates — two different keys truncating to one name
 * would be one lock pretending to be two.
 */
function lockName(key: string): string {
  return key.length <= MYSQL_LOCK_NAME_MAX ? key : key.slice(0, MYSQL_LOCK_NAME_MAX);
}

/** MySQL's hard limit on a `GET_LOCK` name (8.0+). */
const MYSQL_LOCK_NAME_MAX = 64;
