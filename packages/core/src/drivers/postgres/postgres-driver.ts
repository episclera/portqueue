import { createHash } from 'node:crypto';
import { DatabaseEngine, DeduplicationReason, RetentionMode } from '../../options/enums';
import { ACTIVE_STATUSES, FINISHED_STATUSES, JobStatus } from '../../jobs/job-state.enum';
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
import { POSTGRES_MIGRATIONS } from './migrations';
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

export interface PostgresDriverOptions {
  connectionString?: string;
  /** An existing `pg.Pool` to share with the app. */
  pool?: unknown;
  /** Any `pg.PoolConfig` (host/user/password/database/…). */
  config?: Record<string, unknown>;
  /**
   * DB schema for all objects. Every table name is qualified with it and the migration creates it
   * (`CREATE SCHEMA IF NOT EXISTS`), so this is honoured rather than merely accepted.
   */
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

export type { RawResult, Session };

/** `undefined_table` — the only error `getSchemaVersion` may read as "never migrated". */
const PG_UNDEFINED_TABLE = '42P01';
/** `invalid_schema_name` — the schema itself is absent, which is the same "not migrated" state. */
const PG_UNDEFINED_SCHEMA = '3F000';

/**
 * Postgres driver — the full-feature reference driver and the sole owner of the PG-wire SQL
 * surface: `$1`-style placeholders, LISTEN/NOTIFY on a dedicated connection, advisory locks for
 * leader-only tasks, SKIP LOCKED claiming, RETURNING everywhere, real keys and indexes. No method
 * emits a relational JOIN — relationships resolve by name/key lookups — and idempotency/singleton
 * dedup is enforced here in code rather than by a constraint, so behaviour matches an engine that
 * could not honour one. The `pg` package is an optional peer, imported lazily inside `connect()`.
 *
 * Row mapping, value conversion, insert value lists and the affinity scan arithmetic come from
 * {@link BaseDriver} — mechanism, not SQL. Every statement string in this file is Postgres'.
 *
 * PG-wire subclassing: `PgliteDriver` extends this class and overrides only the connection
 * mechanism (`connect`/`disconnect`/`execute`/`transaction`/`probe`) plus the features PGLite
 * lacks. Every query method below is therefore shared with PGLite — treat a change here as a
 * change to both engines, and if a tweak is genuinely Postgres-only, override it in `PgliteDriver`
 * rather than branching on the engine here. No other engine shares this code.
 */
export class PostgresDriver extends BaseDriver implements Driver {
  readonly engine: DatabaseEngine = DatabaseEngine.POSTGRES;
  readonly capabilities: DriverCapabilitySet = capabilities({
    [DriverCapability.SKIP_LOCKED]: true,
    [DriverCapability.RETURNING]: true,
    [DriverCapability.TRANSACTIONS]: true,
    [DriverCapability.LISTEN_NOTIFY]: true,
    [DriverCapability.ADVISORY_LOCK]: true,
  });
  readonly migrations: MigrationStep[] = toMigrationSteps(POSTGRES_MIGRATIONS);

  private pool: PgPool | null = null;
  private listenClient: PgClient | null = null;
  private readonly listeners = new Map<string, Set<(payload: string) => void>>();
  private readonly options: PostgresDriverOptions;

  constructor(options: PostgresDriverOptions = {}) {
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

  /** Run one statement. `protected` so a PG-wire subclass can swap in its own client. */
  protected async execute(
    sql: string,
    params: readonly unknown[],
    session?: Session,
  ): Promise<RawResult> {
    const target = (session as PgClient | undefined) ?? this.pool;
    if (!target) throw new DriverConnectionError('Postgres driver is not connected.');
    const res = await target.query(sql, params);
    return { rows: res.rows ?? [], rowCount: res.rowCount ?? res.rows?.length ?? 0 };
  }

  /** Wrap `fn` in a transaction. `protected` so a PG-wire subclass can swap in its own client. */
  protected async transaction<T>(fn: (session: Session) => Promise<T>): Promise<T> {
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

  /** Postgres uses `$1`-style positional placeholders. */
  protected ph(index0: number): string {
    return `$${index0 + 1}`;
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
    let serverVersion = 'unknown';
    if (this.pool) {
      const res = await this.pool.query('SHOW server_version');
      serverVersion = String(res.rows[0]?.server_version ?? 'unknown');
    }
    return { serverVersion, verifiedCapabilities: this.enabledCapabilities() };
  }

  /**
   * The applied schema version, or null when the migration table (or its schema) does not exist yet.
   * Only those two error codes read as "not migrated": a dropped connection or a permissions error
   * has to surface, because reading it as version 0 would start a full migration run against a
   * database that may already be fully migrated.
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
      if (this.isMissingSchemaObject(err)) return null;
      throw new DriverQueryError('Failed to read the applied schema version.', err);
    }
  }

  /** Whether an error means "the object isn't there yet" rather than "the query failed". */
  protected isMissingSchemaObject(err: unknown): boolean {
    const code = (err as { code?: unknown } | null)?.code;
    return code === PG_UNDEFINED_TABLE || code === PG_UNDEFINED_SCHEMA;
  }

  /**
   * Apply one migration's DDL and record its version in the **same** transaction, so a crash
   * between the two can never leave an applied-but-unrecorded migration.
   */
  async applyMigration(options: { migration: MigrationStep }): Promise<void> {
    const { migration } = options;
    const statements = migration.statements(this.context);
    await this.transaction(async (session) => {
      for (const sql of statements) await this.execute(sql, [], session);
      const now = Date.now();
      await this.execute(
        `INSERT INTO ${this.t(TableName.MIGRATION)} (${MigrationColumn.VERSION}, ${MigrationColumn.CREATED_AT}, ${MigrationColumn.UPDATED_AT}) ` +
          `VALUES (${this.phList(3)}) ON CONFLICT (${MigrationColumn.VERSION}) DO NOTHING`,
        [migration.version, now, now],
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
   * `INSERT … RETURNING`. The dedup pre-check and the insert share one transaction, which is both
   * the "read-then-write runs in a transaction" invariant and what narrows the dedup race to the
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
          // Paired back by id rather than by position, so nothing depends on RETURNING preserving
          // the VALUES order.
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
        const statusPh = this.phList(ACTIVE_STATUSES.length, 1 + singletonKeys.length);
        const res = await run(
          `SELECT ${cols}, ${JobColumn.SINGLETON_KEY} FROM ${this.t(TableName.JOB)} ` +
            `WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.SINGLETON_KEY} IN (${this.phList(singletonKeys.length, 1)}) ` +
            `AND ${JobColumn.STATUS} IN (${statusPh})`,
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
  protected dedupResult(row: Row, reason: DeduplicationReason): InsertedJobRow {
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
    // allowed to coexist by design; the caller enforces idempotency-key dedup ahead of this call
    // (see ProducerService), so nothing here needs a conflict target.
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
    // One statement for the whole set, returning each removed row's queue so the caller can emit
    // its event without a read-back per id.
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

    // Single-instance mode: one guarded UPDATE ... RETURNING inside a transaction. `SKIP LOCKED`
    // makes the inner select skip rows another claimer already holds, and the outer UPDATE is what
    // actually takes them — so no two workers can ever return the same row.
    if (!instanceKey) {
      return this.transaction(async (session) => {
        const res = await this.execute(
          `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.STARTED_AT} = ${this.ph(1)}, ` +
            `${JobColumn.LOCKED_UNTIL} = ${this.ph(2)}, ${JobColumn.UPDATED_AT} = ${this.ph(3)} ` +
            `WHERE ${JobColumn.ID} IN (SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} ` +
            `WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(4)} AND ${JobColumn.STATUS} IN (${this.ph(5)}, ${this.ph(6)}) ` +
            `AND ${JobColumn.START_AFTER} <= ${this.ph(7)} AND (${JobColumn.EXPIRE_AT} IS NULL OR ${JobColumn.EXPIRE_AT} > ${this.ph(8)}) ` +
            `ORDER BY ${JobColumn.PRIORITY} DESC, ${JobColumn.START_AFTER} ASC LIMIT ${this.ph(9)} FOR UPDATE SKIP LOCKED) ` +
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
          session,
        );
        return this.sortClaimed(res.rows.map((r) => this.mapJob(r)));
      });
    }

    // Multi-instance mode: affinity is a regex, which portable SQL cannot evaluate, so page through
    // candidates highest-priority-first and filter here. The scan takes `FOR UPDATE SKIP LOCKED`
    // and the guarded UPDATE runs in the same transaction, so a candidate this instance picks
    // cannot be claimed by another between the two statements.
    const { pageSize, maxScan } = this.affinityPlan(limit);
    return this.transaction(async (session) => {
      const ids = new Set<string>();
      for (let offset = 0; ids.size < limit && offset < maxScan; offset += pageSize) {
        const sel = await this.execute(
          `SELECT ${JobColumn.ID}, ${JobColumn.PREFERRED_INSTANCE_KEY_PATTERN} FROM ${this.t(TableName.JOB)} ` +
            `WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.STATUS} IN (${this.ph(1)}, ${this.ph(2)}) ` +
            `AND ${JobColumn.START_AFTER} <= ${this.ph(3)} AND (${JobColumn.EXPIRE_AT} IS NULL OR ${JobColumn.EXPIRE_AT} > ${this.ph(4)}) ` +
            `ORDER BY ${JobColumn.PRIORITY} DESC, ${JobColumn.START_AFTER} ASC ` +
            `LIMIT ${this.ph(5)} OFFSET ${this.ph(6)} FOR UPDATE SKIP LOCKED`,
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
    // queue to wake, and who was holding the job. Return stalled jobs to PENDING (RETRY handling
    // happens in the completion path on the next failure).
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
    // `name` is the primary key, so a page can no longer contain the same queue twice and there is
    // nothing to dedupe after the window — `items.length` and `total` always agree.
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
    // RETURNING the row means the caller refreshes its cached pause flags from this one statement
    // rather than following it with a read.
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
    // it the read-back would not see the row just inserted, and on a single-connection engine it
    // would deadlock behind the in-flight transaction.
    //
    // `name` is the primary key, so `ON CONFLICT DO NOTHING` makes a concurrent create a no-op
    // instead of an error — the conflict target *is* the key, which is the one case the
    // sharded-engine caveat allows. Queue options are process-local (see QueueOptions); only the
    // pause flags are ever persisted, so an existing row is never rewritten from here.
    return this.inTx(options.tx, async (run) => {
      await run(
        `INSERT INTO ${this.t(TableName.QUEUE)} (${QueueColumn.NAME}, ${QueueColumn.PROCESSING_PAUSED}, ` +
          `${QueueColumn.ACCEPTING_PAUSED}, ${QueueColumn.CREATED_AT}, ${QueueColumn.UPDATED_AT}) ` +
          `VALUES (${this.ph(0)}, ${this.ph(1)}, ${this.ph(2)}, ${this.ph(3)}, ${this.ph(4)}) ` +
          `ON CONFLICT (${QueueColumn.NAME}) DO NOTHING`,
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
    // Only removes the queue row. Jobs link by queue_name (no FK), so this never cascades —
    // any leftover job rows keep their name and are unaffected; the caller guards "not in use".
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
    // (independently controlled) pause flag; only the first beat falls through to the INSERT, whose
    // `ON CONFLICT DO NOTHING` makes two simultaneous first beats harmless. The returned row is
    // what the caller reads `processingPaused` from — there is no follow-up read.
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
    // `instance_key` is the primary key, so no post-window dedupe is needed.
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
    // Only removes the instance (monitoring) row. Jobs record processed_on_instance_key as a plain
    // string (no FK), so removing an instance never touches or orphans any job rows.
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
    // Bounded batch: delete finished rows whose retention window has elapsed.
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} IN ` +
        `(SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} WHERE ${where} LIMIT ${limitPh})`,
      params,
    );
    return res.rowCount;
  }

  /**
   * The retention predicate: a DELETE_AFTER row, in a status **its own policy** covers, whose TTL
   * has elapsed since it finished.
   *
   * The per-status term is what makes `retention.statuses` real. A row with a NULL
   * `retention_statuses` is eligible in every finished status (the default); a row that named a
   * subset is eligible only in one of those, matched against the delimited encoding so `,FAILED,`
   * can never be matched by a search for a different token.
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
