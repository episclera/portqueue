import { DatabaseEngine, DeduplicationReason, RetentionMode } from '../../options/enums';
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
import { retentionStatusPattern } from '../shared/retention-statuses';
import { toMigrationSteps } from '../shared/migration';
import { SQLITE_MIGRATIONS } from './migrations';
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

export interface SqliteDriverOptions {
  /** File path, or `:memory:` (default) for an in-process database. */
  path?: string;
  /** An existing `better-sqlite3` `Database` to share with the app. */
  database?: unknown;
  /** Prefix for all created tables (default 'pq_'). */
  tablePrefix?: string;
  /** Logical prefix for pub/sub channels when multiple PortQueues share one DB. */
  namespace?: string;
}

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

/** Sentinel marking "run on the current transaction connection" for the single-conn driver. */
const TX_SESSION = Symbol('sqlite-tx');

/**
 * SQLite driver — it owns its entire SQL surface, so a SQLite-specific change never touches another
 * engine. Uses `better-sqlite3`, a single writer serialized in-process. `?`-style positional
 * placeholders, RETURNING everywhere, real primary keys and partial indexes, no relational JOIN —
 * relationships resolve by name/key lookups, and idempotency/singleton dedup is enforced here in
 * code rather than by a constraint so behaviour matches every other engine. App-generated UUIDs.
 * SQLite has no schemas, so this driver takes no `schema` option.
 *
 * **Claim exclusivity without SKIP LOCKED.** SQLite has no row locks, and it needs none: a write
 * takes the database-wide write lock, so the guarded `UPDATE … WHERE id IN (SELECT …)` is a single
 * atomic statement no concurrent claimer can interleave with. The multi-instance path — which must
 * scan candidates, filter them by regex in the tool, then update — runs both statements inside one
 * `BEGIN IMMEDIATE`, which takes that write lock up front.
 *
 * Row mapping, value conversion and insert value lists come from {@link BaseDriver} — mechanism,
 * not SQL. Every statement string in this file is SQLite's own.
 *
 * `better-sqlite3` rather than the built-in `node:sqlite`: the builtin needs
 * `--experimental-sqlite` on Node 22 and is only unflagged from Node 24, so a driver built on it
 * would fail across most of this package's supported range for a reason no caller could guess.
 */
export class SqliteDriver extends BaseDriver implements Driver {
  readonly engine = DatabaseEngine.SQLITE;
  readonly capabilities: DriverCapabilitySet = capabilities({
    [DriverCapability.RETURNING]: true,
    [DriverCapability.TRANSACTIONS]: true,
  });
  readonly migrations: MigrationStep[] = toMigrationSteps(SQLITE_MIGRATIONS);

  private db: SqliteDatabase | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  /** Set when the app passed its own `Database`; that connection is never closed by us. */
  private readonly borrowed: SqliteDatabase | null;

  constructor(options: SqliteDriverOptions = {}) {
    super({
      ...(options.tablePrefix !== undefined ? { tablePrefix: options.tablePrefix } : {}),
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
    });
    this.path = options.path ?? ':memory:';
    this.borrowed = (options.database as SqliteDatabase | undefined) ?? null;
  }

  // --- Connection management ---
  async connect(): Promise<void> {
    // An app-supplied Database is used as-is: it may already be open in a transaction, and its
    // PRAGMAs are the app's business, not ours.
    if (this.borrowed) {
      this.db = this.borrowed;
      return;
    }
    type DatabaseCtor = new (path: string) => SqliteDatabase;
    let Database: DatabaseCtor;
    try {
      // Dynamic specifier so TS doesn't require the optional peer's types at build time. The
      // constructor is the module's sole export, reached through `default` under ESM interop.
      const mod = (await import('better-sqlite3' as string)) as { default?: DatabaseCtor };
      Database = (mod.default ?? mod) as unknown as DatabaseCtor;
    } catch {
      throw new MissingPeerDependencyError('better-sqlite3', 'SQLite');
    }
    try {
      this.db = new Database(this.path);
      this.db.exec('PRAGMA journal_mode=WAL;');
      this.db.exec('PRAGMA busy_timeout=5000;');
      this.db.exec('PRAGMA foreign_keys=ON;');
    } catch (err) {
      throw new DriverConnectionError(`Failed to open SQLite database '${this.path}'.`, err);
    }
  }

  async disconnect(): Promise<void> {
    // Only close what we opened — a borrowed Database outlives this driver.
    if (!this.borrowed) this.db?.close();
    this.db = null;
  }

  /** Serialize all access (better-sqlite3 is synchronous; transactions must not interleave). */
  private runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.lock.then(() => fn());
    this.lock = next.catch(() => undefined);
    return next;
  }

  private raw(sql: string, params: readonly unknown[]): RawResult {
    if (!this.db) throw new DriverConnectionError('SQLite driver is not connected.');
    const bind = params.map((p) =>
      p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p,
    );
    const stmt = this.db.prepare(sql);
    if (/^\s*select/i.test(sql) || /returning/i.test(sql)) {
      const rows = stmt.all(...bind) as Array<Record<string, unknown>>;
      return { rows, rowCount: rows.length };
    }
    const info = stmt.run(...bind);
    return { rows: [], rowCount: Number(info.changes) };
  }

  protected async execute(
    sql: string,
    params: readonly unknown[],
    session?: Session,
  ): Promise<RawResult> {
    // Inside a transaction (session set), we already hold the lock — run directly.
    if (session === TX_SESSION) return this.raw(sql, params);
    return this.runExclusive(() => this.raw(sql, params));
  }

  protected async transaction<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    return this.runExclusive(async () => {
      this.raw('BEGIN IMMEDIATE', []);
      try {
        const result = await fn(TX_SESSION);
        this.raw('COMMIT', []);
        return result;
      } catch (err) {
        try {
          this.raw('ROLLBACK', []);
        } catch {
          /* ignore rollback error */
        }
        throw err;
      }
    });
  }

  /** SQLite uses `?` positional placeholders. */
  protected ph(_index0: number): string {
    return '?';
  }

  /**
   * The trailing `LIMIT`/`OFFSET` for a list read, appending each bound value to `params`.
   * Returns an empty string when the caller asked for no window, so core's unpaged reads emit
   * exactly the SQL they always did.
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
    // SQLite has no server version to report.
    return { serverVersion: 'unknown', verifiedCapabilities: this.enabledCapabilities() };
  }

  /**
   * The applied schema version, or null when the migration table does not exist yet. Only that one
   * condition reads as "not migrated": a corrupt file or a locked database has to surface rather
   * than trigger a migration run against a database that may already be migrated.
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
      if (this.isMissingTable(err)) return null;
      throw new DriverQueryError('Failed to read the applied schema version.', err);
    }
  }

  /**
   * SQLite reports a missing relation as a generic `SQLITE_ERROR`, so the message is the only signal
   * that distinguishes it from any other statement failure.
   */
  private isMissingTable(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /no such table/i.test(message);
  }

  /**
   * Apply one migration's DDL and record its version in the **same** transaction, so a crash
   * between the two can never leave an applied-but-unrecorded migration.
   */
  async applyMigration(options: { migration: MigrationStep }): Promise<void> {
    const statements = options.migration.statements(this.context);
    await this.transaction(async (session) => {
      for (const sql of statements) await this.execute(sql, [], session);
      const now = Date.now();
      await this.execute(
        `INSERT INTO ${this.t(TableName.MIGRATION)} (${MigrationColumn.VERSION}, ${MigrationColumn.APPLIED_AT}, ${MigrationColumn.CREATED_AT}, ${MigrationColumn.UPDATED_AT}) ` +
          `VALUES (${this.phList(4)}) ON CONFLICT (${MigrationColumn.VERSION}) DO NOTHING`,
        [options.migration.version, now, now, now],
        session,
      );
    });
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
   * `INSERT … RETURNING`, both inside one transaction — which is what narrows the dedup race to the
   * width of a single statement pair.
   */
  async insertJobs(options: {
    jobs: NewJobRecord[];
    tx?: TransactionHandle;
  }): Promise<InsertedJobRow[]> {
    const { jobs, tx } = options;
    if (!jobs.length) return [];
    return this.inTx(tx, async (run) => {
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
          const inserted = await run(
            `INSERT INTO ${this.t(TableName.JOB)} (${JOB_COLUMNS.join(', ')}) VALUES ${tuples.join(', ')} ` +
              `RETURNING ${JobColumn.ID}, ${JobColumn.STATUS}, ${JobColumn.START_AFTER}`,
            params,
          );
          const byId = new Map(inserted.rows.map((row) => [String(row[JobColumn.ID]), row]));
          for (const { index, id } of chunk) {
            const row = byId.get(id);
            if (!row) throw new DriverQueryError(`Insert did not return job '${id}'.`);
            results[index] = {
              id,
              status: row[JobColumn.STATUS] as JobStatus,
              startAfter: Number(row[JobColumn.START_AFTER]),
              deduplicated: false,
            };
          }
        } catch (err) {
          if (err instanceof DriverQueryError) throw err;
          throw new DriverQueryError(
            `Failed to insert ${chunk.length} job(s) on queue '${jobs[chunk[0]!.index]!.queueName}'.`,
            err,
          );
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
    // Plain INSERT — NOT an UPSERT and no pattern-based dedup. Identical recurrences on a queue are
    // allowed to coexist by design; the caller enforces idempotency-key dedup ahead of this call.
    const { values } = this.scheduleInsertValues(options.schedule, Date.now());
    const res = await this.runMaybeTx(
      `INSERT INTO ${this.t(TableName.SCHEDULE)} (${SCHEDULE_INSERT_COLUMNS.join(', ')}) ` +
        `VALUES (${this.phList(values.length)}) RETURNING *`,
      values,
      options.tx,
    );
    return this.mapSchedule(res.rows[0]!);
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
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.SCHEDULE)} WHERE ${ScheduleColumn.ID} IN (${this.phList(options.scheduleIds.length)}) ` +
        `RETURNING ${ScheduleColumn.ID}, ${ScheduleColumn.QUEUE_NAME}`,
      options.scheduleIds,
      options.tx,
    );
    return res.rows.map((r) => this.mapScheduleRef(r));
  }

  async setScheduleEnabled(options: {
    scheduleId: string;
    enabled: boolean;
    now: number;
    tx?: TransactionHandle;
  }): Promise<ScheduleRef | null> {
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.SCHEDULE)} SET ${ScheduleColumn.ENABLED} = ${this.ph(0)}, ${ScheduleColumn.UPDATED_AT} = ${this.ph(1)} ` +
        `WHERE ${ScheduleColumn.ID} = ${this.ph(2)} RETURNING ${ScheduleColumn.ID}, ${ScheduleColumn.QUEUE_NAME}`,
      [this.boolIn(options.enabled), options.now, options.scheduleId],
      options.tx,
    );
    return res.rows[0] ? this.mapScheduleRef(res.rows[0]) : null;
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
    const cols = JOB_COLUMNS.join(', ');

    // Single-instance mode: one guarded UPDATE ... RETURNING. SQLite has no row locks and needs
    // none — a write holds the database-wide write lock, so this single statement cannot interleave
    // with another claimer's and no two workers can return the same row.
    if (!instanceKey) {
      const res = await this.runMaybeTx(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.STARTED_AT} = ${this.ph(1)}, ` +
          `${JobColumn.LOCKED_UNTIL} = ${this.ph(2)}, ${JobColumn.UPDATED_AT} = ${this.ph(3)} ` +
          `WHERE ${JobColumn.ID} IN (SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} ` +
          `WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(4)} AND ${JobColumn.STATUS} IN (${this.ph(5)}, ${this.ph(6)}) ` +
          `AND ${JobColumn.START_AFTER} <= ${this.ph(7)} AND (${JobColumn.EXPIRE_AT} IS NULL OR ${JobColumn.EXPIRE_AT} > ${this.ph(8)}) ` +
          `ORDER BY ${JobColumn.PRIORITY} DESC, ${JobColumn.START_AFTER} ASC LIMIT ${this.ph(9)}) ` +
          `RETURNING ${cols}`,
        [
          JobStatus.ACTIVE,
          now,
          lockedUntil,
          now,
          queueName,
          JobStatus.PENDING,
          JobStatus.RETRY,
          now,
          now,
          limit,
        ],
      );
      return this.sortClaimed(res.rows.map((r) => this.mapJob(r)));
    }

    // Multi-instance mode: affinity is a regex, which SQL cannot evaluate, so page through
    // candidates highest-priority-first and filter here. `BEGIN IMMEDIATE` takes the write lock
    // before the first scan, so no other claimer can take a candidate between the scan and the
    // guarded UPDATE.
    const { pageSize, maxScan } = this.affinityPlan(limit);
    return this.transaction(async (session) => {
      const ids = new Set<string>();
      for (let offset = 0; ids.size < limit && offset < maxScan; offset += pageSize) {
        const sel = await this.execute(
          `SELECT ${JobColumn.ID}, ${JobColumn.PREFERRED_INSTANCE_KEY_PATTERN} FROM ${this.t(TableName.JOB)} ` +
            `WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.STATUS} IN (${this.ph(1)}, ${this.ph(2)}) ` +
            `AND ${JobColumn.START_AFTER} <= ${this.ph(3)} AND (${JobColumn.EXPIRE_AT} IS NULL OR ${JobColumn.EXPIRE_AT} > ${this.ph(4)}) ` +
            `ORDER BY ${JobColumn.PRIORITY} DESC, ${JobColumn.START_AFTER} ASC LIMIT ${this.ph(5)} OFFSET ${this.ph(6)}`,
          [queueName, JobStatus.PENDING, JobStatus.RETRY, now, now, pageSize, offset],
          session,
        );
        if (sel.rows.length === 0) break; // exhausted — nothing more to scan
        this.collectAffinityMatches(sel.rows, instanceKey, limit, ids);
        if (sel.rows.length < pageSize) break; // last (partial) page
      }
      if (ids.size === 0) return [];
      const idList = [...ids];
      const head = [JobStatus.ACTIVE, now, lockedUntil, instanceKey, now];
      const upd = await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.STARTED_AT} = ${this.ph(1)}, ` +
          `${JobColumn.LOCKED_UNTIL} = ${this.ph(2)}, ${JobColumn.PROCESSED_ON_INSTANCE_KEY} = ${this.ph(3)}, ` +
          `${JobColumn.UPDATED_AT} = ${this.ph(4)} ` +
          `WHERE ${JobColumn.ID} IN (${this.phList(idList.length, head.length)}) ` +
          `AND ${JobColumn.STATUS} IN (${this.ph(head.length + idList.length)}, ${this.ph(head.length + idList.length + 1)}) ` +
          `RETURNING ${cols}`,
        [...head, ...idList, JobStatus.PENDING, JobStatus.RETRY],
        session,
      );
      return this.sortClaimed(upd.rows.map((r) => this.mapJob(r)));
    });
  }

  async extendLock(options: {
    jobId: string;
    lockDurationSeconds: number;
    now: number;
  }): Promise<boolean> {
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.LOCKED_UNTIL} = ${this.ph(0)}, ${JobColumn.UPDATED_AT} = ${this.ph(1)} ` +
        `WHERE ${JobColumn.ID} = ${this.ph(2)} AND ${JobColumn.STATUS} = ${this.ph(3)}`,
      [
        this.lockDeadline(options.now, options.lockDurationSeconds),
        options.now,
        options.jobId,
        JobStatus.ACTIVE,
      ],
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
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.RETURN_VALUE} = ${this.ph(1)}, ` +
        `${JobColumn.COMPLETED_AT} = ${this.ph(2)}, ${JobColumn.UPDATED_AT} = ${this.ph(3)}, ${JobColumn.LOCKED_UNTIL} = NULL ` +
        `WHERE ${JobColumn.ID} = ${this.ph(4)}`,
      [
        JobStatus.COMPLETED,
        this.toJson(options.returnValue),
        options.now,
        options.now,
        options.jobId,
      ],
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
    await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.RETRY_ATTEMPT} = ${this.ph(1)}, ` +
        `${JobColumn.START_AFTER} = ${this.ph(2)}, ${JobColumn.RETRIED_AT} = ${this.ph(3)}, ${JobColumn.FAILURE_MESSAGE} = ${this.ph(4)}, ` +
        `${JobColumn.UPDATED_AT} = ${this.ph(5)}, ${JobColumn.LOCKED_UNTIL} = NULL WHERE ${JobColumn.ID} = ${this.ph(6)}`,
      [
        JobStatus.RETRY,
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
    await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.FAILED_AT} = ${this.ph(1)}, ` +
        `${JobColumn.FAILURE_MESSAGE} = ${this.ph(2)}, ${JobColumn.UPDATED_AT} = ${this.ph(3)}, ${JobColumn.LOCKED_UNTIL} = NULL ` +
        `WHERE ${JobColumn.ID} = ${this.ph(4)}`,
      [JobStatus.FAILED, options.now, options.lastError, options.now, options.jobId],
    );
  }

  async reclaimStalledJobs(options: {
    queueName?: string;
    limit: number;
    now: number;
  }): Promise<StalledJobRef[]> {
    // Bounded, and returning three columns rather than all 34: the caller only needs the id, the
    // queue to wake, and who was holding the job.
    const params: unknown[] = [JobStatus.PENDING, options.now, JobStatus.ACTIVE, options.now];
    let where =
      `${JobColumn.STATUS} = ${this.ph(2)} AND ${JobColumn.LOCKED_UNTIL} IS NOT NULL ` +
      `AND ${JobColumn.LOCKED_UNTIL} < ${this.ph(3)}`;
    if (options.queueName) {
      where += ` AND ${JobColumn.QUEUE_NAME} = ${this.ph(params.length)}`;
      params.push(options.queueName);
    }
    const limitPh = this.ph(params.length);
    params.push(options.limit);
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.STALLED_AT} = ${this.ph(1)}, ` +
        `${JobColumn.LOCKED_UNTIL} = NULL ` +
        `WHERE ${JobColumn.ID} IN (SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} WHERE ${where} LIMIT ${limitPh}) ` +
        `RETURNING ${JobColumn.ID}, ${JobColumn.QUEUE_NAME}, ${JobColumn.PROCESSED_ON_INSTANCE_KEY}`,
      params,
    );
    return res.rows.map((r) => ({
      ...this.mapJobRef(r),
      previousInstanceKey: this.strOrNull(r[JobColumn.PROCESSED_ON_INSTANCE_KEY]),
    }));
  }

  async expireDueJobs(options: {
    queueName?: string;
    limit: number;
    now: number;
  }): Promise<JobRef[]> {
    const params: unknown[] = [
      JobStatus.EXPIRED,
      options.now,
      options.now,
      JobStatus.PENDING,
      JobStatus.RETRY,
      options.now,
    ];
    let where =
      `${JobColumn.STATUS} IN (${this.ph(3)}, ${this.ph(4)}) AND ${JobColumn.EXPIRE_AT} IS NOT NULL ` +
      `AND ${JobColumn.EXPIRE_AT} <= ${this.ph(5)}`;
    if (options.queueName) {
      where += ` AND ${JobColumn.QUEUE_NAME} = ${this.ph(params.length)}`;
      params.push(options.queueName);
    }
    const limitPh = this.ph(params.length);
    params.push(options.limit);
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.EXPIRED_AT} = ${this.ph(1)}, ` +
        `${JobColumn.UPDATED_AT} = ${this.ph(2)}, ${JobColumn.LOCKED_UNTIL} = NULL ` +
        `WHERE ${JobColumn.ID} IN (SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} WHERE ${where} LIMIT ${limitPh}) ` +
        `RETURNING ${JobColumn.ID}, ${JobColumn.QUEUE_NAME}`,
      params,
    );
    return res.rows.map((r) => this.mapJobRef(r));
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
    // Guarded on `status != ACTIVE`. Re-arming a running job would clear its lock and let a second
    // worker claim it while the first handler is still going — the same job running twice at once.
    // An ACTIVE or missing id is simply not re-armed, so a batch never fails on one stale id.
    const head: unknown[] = [JobStatus.PENDING, options.now, options.now];
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.RETRY_ATTEMPT} = 0, ` +
        `${JobColumn.START_AFTER} = ${this.ph(1)}, ${JobColumn.FAILED_AT} = NULL, ${JobColumn.FAILURE_MESSAGE} = NULL, ` +
        `${JobColumn.COMPLETED_AT} = NULL, ${JobColumn.STARTED_AT} = NULL, ${JobColumn.CANCELLED_AT} = NULL, ` +
        `${JobColumn.EXPIRED_AT} = NULL, ${JobColumn.RETURN_VALUE} = NULL, ${JobColumn.LOCKED_UNTIL} = NULL, ` +
        `${JobColumn.UPDATED_AT} = ${this.ph(2)} ` +
        `WHERE ${JobColumn.ID} IN (${this.phList(options.jobIds.length, head.length)}) ` +
        `AND ${JobColumn.STATUS} <> ${this.ph(head.length + options.jobIds.length)} ` +
        `RETURNING ${JobColumn.ID}, ${JobColumn.QUEUE_NAME}, ${JobColumn.STATUS}, ${JobColumn.START_AFTER}`,
      [...head, ...options.jobIds, JobStatus.ACTIVE],
      options.tx,
    );
    return res.rows.map((r) => ({
      ...this.mapJobRef(r),
      status: r[JobColumn.STATUS] as JobStatus,
      startAfter: Number(r[JobColumn.START_AFTER]),
    }));
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
    const res = await this.runMaybeTx(
      `SELECT ${keyColumn}, ${JobColumn.STATUS}, COUNT(*) AS c FROM ${this.t(TableName.JOB)} ` +
        `WHERE ${keyColumn} IN (${this.phList(keys.length)}) GROUP BY ${keyColumn}, ${JobColumn.STATUS}`,
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
      // A schedule is searchable by any of the three things the table actually shows.
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
    const head: unknown[] = [JobStatus.CANCELLED, options.now, options.now];
    const tail = [JobStatus.PENDING, JobStatus.RETRY];
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.CANCELLED_AT} = ${this.ph(1)}, ` +
        `${JobColumn.UPDATED_AT} = ${this.ph(2)}, ${JobColumn.LOCKED_UNTIL} = NULL ` +
        `WHERE ${JobColumn.ID} IN (${this.phList(options.jobIds.length, head.length)}) ` +
        `AND ${JobColumn.STATUS} IN (${this.phList(tail.length, head.length + options.jobIds.length)}) ` +
        `RETURNING ${JobColumn.ID}, ${JobColumn.QUEUE_NAME}`,
      [...head, ...options.jobIds, ...tail],
      options.tx,
    );
    return res.rows.map((r) => this.mapJobRef(r));
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
    // Never delete a running job — an ACTIVE row belongs to a live handler, so it is skipped and
    // simply absent from the result; cancel it first.
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} IN (${this.phList(options.jobIds.length)}) ` +
        `AND ${JobColumn.STATUS} <> ${this.ph(options.jobIds.length)} ` +
        `RETURNING ${JobColumn.ID}, ${JobColumn.QUEUE_NAME}`,
      [...options.jobIds, JobStatus.ACTIVE],
      options.tx,
    );
    return res.rows.map((r) => this.mapJobRef(r));
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
    const res = await this.runMaybeTx(
      `UPDATE ${this.t(TableName.QUEUE)} SET ${sets.join(', ')} WHERE ${QueueColumn.NAME} = ${namePh} RETURNING *`,
      params,
      options.tx,
    );
    return res.rows[0] ? this.mapQueue(res.rows[0]) : null;
  }

  async ensureQueue(options: {
    name: string;
    options?: QueueOptions;
    now: number;
    tx?: TransactionHandle;
  }): Promise<QueueRow> {
    // Get-or-create in one statement pair, on the caller's transaction when there is one: outside
    // it the read-back would not see the row just inserted, and on this single-connection engine it
    // would deadlock behind the in-flight transaction. `name` is the primary key, so
    // `ON CONFLICT DO NOTHING` makes a concurrent create a no-op rather than an error. Queue options
    // are process-local; only the pause flags are ever persisted, so an existing row is never
    // rewritten from here.
    return this.inTx(options.tx, async (run) => {
      await run(
        `INSERT INTO ${this.t(TableName.QUEUE)} (${QueueColumn.NAME}, ${QueueColumn.PROCESSING_PAUSED}, ` +
          `${QueueColumn.ACCEPTING_PAUSED}, ${QueueColumn.CREATED_AT}, ${QueueColumn.UPDATED_AT}) ` +
          `VALUES (${this.phList(5)}) ON CONFLICT (${QueueColumn.NAME}) DO NOTHING`,
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
    // Update-first, then insert if absent. The heartbeat's common case is "row exists", so the
    // guarded UPDATE ... RETURNING resolves it in one round trip and never touches the
    // (independently controlled) pause flag. The returned row is what the caller reads
    // `processingPaused` from — there is no follow-up read.
    const m = options.metrics;
    return this.inTx(undefined, async (run) => {
      const updated = await run(
        `UPDATE ${this.t(TableName.INSTANCE)} SET ${InstanceColumn.LAST_SEEN_AT} = ${this.ph(0)}, ` +
          `${InstanceColumn.UPDATED_AT} = ${this.ph(1)}, ` +
          `${InstanceColumn.CPU_PERCENT} = COALESCE(${this.ph(2)}, ${InstanceColumn.CPU_PERCENT}), ` +
          `${InstanceColumn.MEMORY_PERCENT} = COALESCE(${this.ph(3)}, ${InstanceColumn.MEMORY_PERCENT}) ` +
          `WHERE ${InstanceColumn.INSTANCE_KEY} = ${this.ph(4)} RETURNING *`,
        [
          options.now,
          options.now,
          m?.cpuPercent ?? null,
          m?.memoryPercent ?? null,
          options.instanceKey,
        ],
      );
      if (updated.rows[0]) return this.mapInstance(updated.rows[0]);
      await run(
        `INSERT INTO ${this.t(TableName.INSTANCE)} (${InstanceColumn.INSTANCE_KEY}, ${InstanceColumn.PROCESSING_PAUSED}, ` +
          `${InstanceColumn.CREATED_AT}, ${InstanceColumn.UPDATED_AT}, ${InstanceColumn.LAST_SEEN_AT}, ` +
          `${InstanceColumn.CPU_PERCENT}, ${InstanceColumn.MEMORY_PERCENT}) ` +
          `VALUES (${this.phList(7)}) ON CONFLICT (${InstanceColumn.INSTANCE_KEY}) DO NOTHING`,
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
      const read = await run(
        `SELECT * FROM ${this.t(TableName.INSTANCE)} WHERE ${InstanceColumn.INSTANCE_KEY} = ${this.ph(0)}`,
        [options.instanceKey],
      );
      if (!read.rows[0]) {
        throw new DriverQueryError(`Failed to register instance '${options.instanceKey}'.`);
      }
      return this.mapInstance(read.rows[0]);
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
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} IN ` +
        `(SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} WHERE ${where} LIMIT ${limitPh})`,
      params,
    );
    return res.rowCount;
  }

  /**
   * The retention predicate: a DELETE_AFTER row, in a status **its own policy** covers, whose TTL
   * has elapsed since it finished. A row with a NULL `retention_statuses` is eligible in every
   * finished status (the default); a row that named a subset is eligible only in one of those.
   */
  private retentionWhere(olderThan: number, params: unknown[]): string {
    const modePh = this.ph(params.length);
    params.push(RetentionMode.DELETE_AFTER);
    const statusPh = this.phList(FINISHED_STATUSES.length, params.length);
    params.push(...FINISHED_STATUSES);
    const scoped = FINISHED_STATUSES.map((status) => {
      const clause =
        `(${JobColumn.STATUS} = ${this.ph(params.length)} AND ` +
        `${JobColumn.RETENTION_STATUSES} LIKE ${this.ph(params.length + 1)})`;
      params.push(status, retentionStatusPattern(status));
      return clause;
    });
    const cutoffPh = this.ph(params.length);
    params.push(olderThan);
    return (
      `${JobColumn.RETENTION_MODE} = ${modePh} AND ${JobColumn.RETENTION_TTL_SECONDS} IS NOT NULL ` +
      `AND ${JobColumn.STATUS} IN (${statusPh}) ` +
      `AND (${JobColumn.RETENTION_STATUSES} IS NULL OR ${scoped.join(' OR ')}) ` +
      `AND (COALESCE(${JobColumn.COMPLETED_AT}, ${JobColumn.FAILED_AT}, ${JobColumn.CANCELLED_AT}, ` +
      `${JobColumn.EXPIRED_AT}, ${JobColumn.UPDATED_AT}) + ${JobColumn.RETENTION_TTL_SECONDS} * 1000) <= ${cutoffPh}`
    );
  }

  // --- Pub/sub (interval polling instead of LISTEN/NOTIFY) ---
  async notify(_options: { channel: string; payload: string }): Promise<void> {
    // No-op: SQLite has no LISTEN/NOTIFY; subscribers rely on interval polling.
  }

  async subscribe(_options: {
    channel: string;
    onNotification: (payload: string) => void;
  }): Promise<Subscription> {
    throw new UnsupportedCapabilityError(
      DriverCapability.LISTEN_NOTIFY,
      'SQLite has no LISTEN/NOTIFY; use interval polling.',
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
