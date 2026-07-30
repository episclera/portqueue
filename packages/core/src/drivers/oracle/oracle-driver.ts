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
import { retentionStatusPattern } from '../shared/retention-statuses';
import { toMigrationSteps } from '../shared/migration';
import { ORACLE_MIGRATIONS } from './migrations';
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

export interface OracleDriverOptions {
  user?: string;
  password?: string;
  connectString?: string;
  /** Oracle identifiers are limited to 30 bytes (128 on 12.2+); prefix+table must fit. */
  maxIdentifierLen?: number;
  /**
   * DB schema for all objects. On Oracle a schema **is a user**, so this one is not created by the
   * migration — it must already exist with rights to create tables. Every object name is qualified
   * with it.
   */
  schema?: string;
  /** Prefix for all created tables (default 'pq_'). */
  tablePrefix?: string;
  /** Logical prefix for pub/sub channels when multiple PortQueues share one DB. */
  namespace?: string;
}

interface OracleConnection {
  execute(
    sql: string,
    binds?: unknown[],
    opts?: Record<string, unknown>,
  ): Promise<{ rows?: unknown[]; rowsAffected?: number }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}
interface OraclePool {
  getConnection(): Promise<OracleConnection>;
  close(drainTime?: number): Promise<void>;
}

/** ORA-00942 "table or view does not exist" — the only code that means "not migrated yet". */
const ORA_MISSING_TABLE = 942;

/**
 * Oracle driver — it owns its entire SQL surface, so an Oracle-specific change never touches another
 * engine. `:1`-style colon placeholders, `FOR UPDATE SKIP LOCKED` claiming, real primary keys and
 * indexes. No LISTEN/NOTIFY and no advisory locks; the polling backstop drives wakeups. No method
 * emits a relational JOIN — relationships resolve by name/key lookups — and idempotency/singleton
 * dedup is enforced here in code rather than by a constraint, so behaviour matches every other
 * engine. `oracledb` is an optional peer dependency.
 *
 * **Four Oracle facts shape every statement below**, and each one is a place the previous version of
 * this driver emitted SQL Oracle cannot parse:
 *
 * 1. **No `LIMIT`/`OFFSET`.** Paging is `OFFSET n ROWS FETCH NEXT m ROWS ONLY` (12c+), and a bounded
 *    subquery is `FETCH FIRST n ROWS ONLY`. See {@link window}.
 * 2. **`RETURNING` binds into OUT variables and cannot produce a row set from a multi-row DML.**
 *    Every "mutate and read back" is therefore an explicit two-step in one transaction: select the
 *    affected ids (with `FOR UPDATE SKIP LOCKED` where they are contended), then mutate exactly
 *    those. There is no `RETURNING *` and no `INSERT … RETURNING`, so this driver does not declare
 *    the `RETURNING` capability.
 * 3. **No multi-row `VALUES` and no `ON CONFLICT`.** A batch insert is `INSERT ALL … SELECT 1 FROM
 *    dual`; a get-or-create is `MERGE … WHEN NOT MATCHED THEN INSERT`, whose conflict target is the
 *    primary key.
 * 4. **`CLOB` columns come back as LOB streams, not strings,** unless the client is told otherwise.
 *    `connect()` sets `fetchAsString = [CLOB]` so `data`, `return_value`, `failure_message` and
 *    `job_options` arrive as the strings `mapJob`/`mapSchedule` expect to `JSON.parse`.
 *
 * Row mapping, value conversion and insert value lists come from {@link BaseDriver} — mechanism, not
 * SQL. Oracle is validated with the conformance kit against a real server rather than in CI; see the
 * testing note in CLAUDE.md.
 */
export class OracleDriver extends BaseDriver implements Driver {
  readonly engine = DatabaseEngine.ORACLE;
  readonly capabilities: DriverCapabilitySet = capabilities({
    [DriverCapability.SKIP_LOCKED]: true,
    [DriverCapability.TRANSACTIONS]: true,
    // No row-set RETURNING (it binds OUT variables), no LISTEN/NOTIFY, no advisory lock.
  });
  readonly migrations: MigrationStep[] = toMigrationSteps(ORACLE_MIGRATIONS);

  /**
   * Oracle's `INSERT ALL` repeats the whole column list once per row, so a batch grows the statement
   * text as fast as it grows the bind list. Held well under the shared floor to keep the SQL sane.
   */
  protected override readonly maxBindParams = 4_000;

  private pool: OraclePool | null = null;
  private readonly options: OracleDriverOptions;

  constructor(options: OracleDriverOptions = {}) {
    super({
      ...(options.tablePrefix !== undefined ? { tablePrefix: options.tablePrefix } : {}),
      ...(options.schema !== undefined ? { schema: options.schema } : {}),
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
      ...(options.maxIdentifierLen !== undefined
        ? { maxIdentifierLen: options.maxIdentifierLen }
        : {}),
    });
    this.options = options;
  }

  // --- Connection management ---
  async connect(): Promise<void> {
    let oracledb: {
      createPool(config: Record<string, unknown>): Promise<OraclePool>;
      OUT_FORMAT_OBJECT: number;
      CLOB: number;
      outFormat: number;
      fetchAsString: number[];
    };
    try {
      const mod = (await import('oracledb' as string)) as { default?: unknown };
      oracledb = (mod.default ?? mod) as never;
    } catch {
      throw new MissingPeerDependencyError('oracledb', 'Oracle');
    }
    try {
      oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
      // Without this, a CLOB column arrives as a Lob stream and every `JSON.parse` of a payload
      // fails. Declared once for the process, as `oracledb` intends.
      if (!oracledb.fetchAsString?.includes(oracledb.CLOB)) {
        oracledb.fetchAsString = [...(oracledb.fetchAsString ?? []), oracledb.CLOB];
      }
      this.pool = await oracledb.createPool({
        user: this.options.user,
        password: this.options.password,
        connectString: this.options.connectString,
      });
    } catch (err) {
      throw new DriverConnectionError('Failed to connect to Oracle.', err);
    }
  }

  async disconnect(): Promise<void> {
    await this.pool?.close(0);
    this.pool = null;
  }

  protected async execute(
    sql: string,
    params: readonly unknown[],
    session?: Session,
  ): Promise<RawResult> {
    const conn = session as OracleConnection | undefined;
    if (conn) return this.run(conn, sql, params);
    if (!this.pool) throw new DriverConnectionError('Oracle driver is not connected.');
    const c = await this.pool.getConnection();
    try {
      const res = await this.run(c, sql, params);
      await c.commit();
      return res;
    } finally {
      await c.close();
    }
  }

  private async run(
    conn: OracleConnection,
    sql: string,
    params: readonly unknown[],
  ): Promise<RawResult> {
    const res = await conn.execute(sql, [...params], { autoCommit: false });
    const rows = (res.rows as Array<Record<string, unknown>>) ?? [];
    // Oracle returns column names upper-cased; normalize to our lower_snake keys.
    const normalized = rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) out[k.toLowerCase()] = v;
      return out;
    });
    return { rows: normalized, rowCount: res.rowsAffected ?? normalized.length };
  }

  protected async transaction<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    if (!this.pool) throw new DriverConnectionError('Oracle driver is not connected.');
    const conn = await this.pool.getConnection();
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      throw err;
    } finally {
      await conn.close();
    }
  }

  /** Oracle uses `:N`-style colon placeholders, bound positionally from an array. */
  protected ph(index0: number): string {
    return `:${index0 + 1}`;
  }

  /**
   * Oracle's paging tail: `OFFSET n ROWS FETCH NEXT m ROWS ONLY` (12c+). `OFFSET` must precede
   * `FETCH`, so the offset bind is pushed first — the params array has to match the order the
   * placeholders appear in.
   */
  protected window(page: PageWindow, params: unknown[]): string {
    let sql = '';
    if (page.offset !== undefined) {
      sql += ` OFFSET ${this.ph(params.length)} ROWS`;
      params.push(Math.max(Math.trunc(page.offset), 0));
    }
    if (page.limit !== undefined) {
      sql += ` FETCH NEXT ${this.ph(params.length)} ROWS ONLY`;
      params.push(Math.max(Math.trunc(page.limit), 0));
    }
    return sql;
  }

  /** A bounded subquery tail: Oracle's `FETCH FIRST n ROWS ONLY`, not `LIMIT n`. */
  private fetchFirst(limit: number, params: unknown[]): string {
    const clause = ` FETCH FIRST ${this.ph(params.length)} ROWS ONLY`;
    params.push(Math.max(Math.trunc(limit), 0));
    return clause;
  }

  // --- Probe / migration ---
  async probe(): Promise<DriverProbe> {
    let serverVersion = 'unknown';
    if (this.pool) {
      const res = await this.execute(
        `SELECT version FROM product_component_version WHERE ROWNUM = 1`,
        [],
      );
      serverVersion = String(res.rows[0]?.version ?? 'unknown');
    }
    return { serverVersion, verifiedCapabilities: this.enabledCapabilities() };
  }

  /**
   * The applied schema version, or null when the migration table does not exist yet (ORA-00942).
   * Every other failure surfaces: reading a permissions error as "not migrated" would start a full
   * migration run against a database that may already be migrated.
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
      const errorNum = (err as { errorNum?: unknown } | null)?.errorNum;
      if (errorNum === ORA_MISSING_TABLE) return null;
      throw new DriverQueryError('Failed to read the applied schema version.', err);
    }
  }

  /**
   * Apply one migration's DDL, then record its version.
   *
   * Oracle commits DDL implicitly, so — like MySQL — these cannot share one transaction. That is
   * safe because every statement in the migration swallows its "already exists" code: a crash
   * between the DDL and the version row leaves a schema the next run re-applies as a no-op and then
   * records. The version insert is guarded on its own absence for the same reason.
   */
  async applyMigration(options: { migration: MigrationStep }): Promise<void> {
    const statements = options.migration.statements(this.context);
    for (const sql of statements) await this.execute(sql, []);
    const now = Date.now();
    await this.execute(
      `MERGE INTO ${this.t(TableName.MIGRATION)} t ` +
        `USING (SELECT ${this.ph(0)} AS ${MigrationColumn.VERSION} FROM dual) s ` +
        `ON (t.${MigrationColumn.VERSION} = s.${MigrationColumn.VERSION}) ` +
        `WHEN NOT MATCHED THEN INSERT (${MigrationColumn.VERSION}, ${MigrationColumn.CREATED_AT}, ${MigrationColumn.UPDATED_AT}) ` +
        `VALUES (s.${MigrationColumn.VERSION}, ${this.ph(1)}, ${this.ph(2)})`,
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
   * A real batch insert: one grouped dedup lookup per distinct queue, then a single `INSERT ALL`,
   * both in one transaction. Oracle has no multi-row `VALUES`, so the batch is expressed as
   * `INSERT ALL INTO … VALUES (…) INTO … VALUES (…) SELECT 1 FROM dual`. Nothing is read back — the
   * id, status and `start_after` of a fresh row are exactly what was written.
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

      // Chunked so one statement never exceeds Oracle's bind limit; each chunk is still one
      // `INSERT ALL`.
      for (const chunk of this.chunkForBind(fresh, JOB_COLUMNS.length)) {
        if (!chunk.length) continue;
        const params: unknown[] = [];
        const clauses = chunk.map(({ values }) => {
          const placeholders = this.phList(values.length, params.length);
          params.push(...values);
          return `INTO ${this.t(TableName.JOB)} (${JOB_COLUMNS.join(', ')}) VALUES (${placeholders})`;
        });
        try {
          await run(`INSERT ALL ${clauses.join(' ')} SELECT 1 FROM dual`, params);
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
    // Plain INSERT — NOT an UPSERT and no pattern-based dedup. Oracle cannot return the inserted
    // row as a result set, so insert then read it back by its known id, in one transaction.
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
    // No row-set RETURNING: lock and read the rows, then delete exactly those ids.
    return this.inTx(options.tx, async (run) => {
      const sel = await run(
        `SELECT ${ScheduleColumn.ID}, ${ScheduleColumn.QUEUE_NAME} FROM ${this.t(TableName.SCHEDULE)} ` +
          `WHERE ${ScheduleColumn.ID} IN (${this.phList(options.scheduleIds.length)}) FOR UPDATE`,
        options.scheduleIds,
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

    // Select claimable ids highest-priority-first, locking them for the transaction with SKIP
    // LOCKED so concurrent claimers never contend, then update exactly those and read them back —
    // the three steps Oracle's OUT-variable-only RETURNING forces. Affinity is a regex, which SQL
    // cannot evaluate, so a named instance pages and filters in the tool.
    return this.transaction(async (session) => {
      const ids: string[] = [];
      if (!instanceKey) {
        const params: unknown[] = [queueName, JobStatus.PENDING, JobStatus.RETRY, now, now];
        const sql =
          `SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} ` +
          `WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.STATUS} IN (${this.ph(1)}, ${this.ph(2)}) ` +
          `AND ${JobColumn.START_AFTER} <= ${this.ph(3)} AND (${JobColumn.EXPIRE_AT} IS NULL OR ${JobColumn.EXPIRE_AT} > ${this.ph(4)}) ` +
          `ORDER BY ${JobColumn.PRIORITY} DESC, ${JobColumn.START_AFTER} ASC` +
          this.fetchFirst(limit, params) +
          ` FOR UPDATE SKIP LOCKED`;
        const sel = await this.execute(sql, params, session);
        for (const row of sel.rows) ids.push(String(row[JobColumn.ID]));
      } else {
        const { pageSize, maxScan } = this.affinityPlan(limit);
        const matched = new Set<string>();
        for (let offset = 0; matched.size < limit && offset < maxScan; offset += pageSize) {
          const params: unknown[] = [queueName, JobStatus.PENDING, JobStatus.RETRY, now, now];
          const sql =
            `SELECT ${JobColumn.ID}, ${JobColumn.PREFERRED_INSTANCE_KEY_PATTERN} FROM ${this.t(TableName.JOB)} ` +
            `WHERE ${JobColumn.QUEUE_NAME} = ${this.ph(0)} AND ${JobColumn.STATUS} IN (${this.ph(1)}, ${this.ph(2)}) ` +
            `AND ${JobColumn.START_AFTER} <= ${this.ph(3)} AND (${JobColumn.EXPIRE_AT} IS NULL OR ${JobColumn.EXPIRE_AT} > ${this.ph(4)}) ` +
            `ORDER BY ${JobColumn.PRIORITY} DESC, ${JobColumn.START_AFTER} ASC` +
            this.window({ limit: pageSize, offset }, params) +
            ` FOR UPDATE SKIP LOCKED`;
          const sel = await this.execute(sql, params, session);
          if (sel.rows.length === 0) break;
          this.collectAffinityMatches(sel.rows, instanceKey, limit, matched);
          if (sel.rows.length < pageSize) break;
        }
        ids.push(...matched);
      }
      if (ids.length === 0) return [];

      const head = [JobStatus.ACTIVE, now, lockedUntil, instanceKey ?? null, now];
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.STARTED_AT} = ${this.ph(1)}, ` +
          `${JobColumn.LOCKED_UNTIL} = ${this.ph(2)}, ${JobColumn.PROCESSED_ON_INSTANCE_KEY} = ${this.ph(3)}, ` +
          `${JobColumn.UPDATED_AT} = ${this.ph(4)} ` +
          `WHERE ${JobColumn.ID} IN (${this.phList(ids.length, head.length)}) ` +
          `AND ${JobColumn.STATUS} IN (${this.ph(head.length + ids.length)}, ${this.ph(head.length + ids.length + 1)})`,
        [...head, ...ids, JobStatus.PENDING, JobStatus.RETRY],
        session,
      );
      // Read back only the rows this call actually claimed: same ids, ACTIVE, and holding *our*
      // lock deadline — so a row another claimer took first is excluded.
      const res = await this.execute(
        `SELECT ${JOB_COLUMNS.join(', ')} FROM ${this.t(TableName.JOB)} ` +
          `WHERE ${JobColumn.ID} IN (${this.phList(ids.length)}) AND ${JobColumn.STATUS} = ${this.ph(ids.length)} ` +
          `AND ${JobColumn.LOCKED_UNTIL} = ${this.ph(ids.length + 1)}`,
        [...ids, JobStatus.ACTIVE, lockedUntil],
        session,
      );
      return this.sortClaimed(res.rows.map((r) => this.mapJob(r)));
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
    // Bounded, and only three columns: the caller needs the id, the queue to wake, and who held it.
    const params: unknown[] = [JobStatus.ACTIVE, options.now];
    let where =
      `${JobColumn.STATUS} = ${this.ph(0)} AND ${JobColumn.LOCKED_UNTIL} IS NOT NULL ` +
      `AND ${JobColumn.LOCKED_UNTIL} < ${this.ph(1)}`;
    if (options.queueName) {
      where += ` AND ${JobColumn.QUEUE_NAME} = ${this.ph(params.length)}`;
      params.push(options.queueName);
    }
    const fetch = this.fetchFirst(options.limit, params);
    return this.transaction(async (session) => {
      const sel = await this.execute(
        `SELECT ${JobColumn.ID}, ${JobColumn.QUEUE_NAME}, ${JobColumn.PROCESSED_ON_INSTANCE_KEY} ` +
          `FROM ${this.t(TableName.JOB)} WHERE ${where}${fetch} FOR UPDATE SKIP LOCKED`,
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
          `${JobColumn.LOCKED_UNTIL} = NULL WHERE ${JobColumn.ID} IN (${this.phList(ids.length, 2)})`,
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
    const fetch = this.fetchFirst(options.limit, params);
    return this.transaction(async (session) => {
      const sel = await this.execute(
        `SELECT ${JobColumn.ID}, ${JobColumn.QUEUE_NAME} FROM ${this.t(TableName.JOB)} ` +
          `WHERE ${where}${fetch} FOR UPDATE SKIP LOCKED`,
        params,
        session,
      );
      if (!sel.rows.length) return [];
      const refs = sel.rows.map((r) => this.mapJobRef(r));
      const ids = refs.map((r) => r.jobId);
      await this.execute(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.EXPIRED_AT} = ${this.ph(1)}, ` +
          `${JobColumn.UPDATED_AT} = ${this.ph(2)}, ${JobColumn.LOCKED_UNTIL} = NULL ` +
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
    // Guarded on `status != ACTIVE`. Re-arming a running job would clear its lock and let a second
    // worker claim it while the first handler is still going. An ACTIVE or missing id is simply not
    // re-armed, so a batch never fails on one stale id.
    return this.inTx(options.tx, async (run) => {
      const sel = await run(
        `SELECT ${JobColumn.ID}, ${JobColumn.QUEUE_NAME} FROM ${this.t(TableName.JOB)} ` +
          `WHERE ${JobColumn.ID} IN (${this.phList(options.jobIds.length)}) ` +
          `AND ${JobColumn.STATUS} <> ${this.ph(options.jobIds.length)} FOR UPDATE`,
        [...options.jobIds, JobStatus.ACTIVE],
      );
      if (!sel.rows.length) return [];
      const refs = sel.rows.map((r) => this.mapJobRef(r));
      const ids = refs.map((r) => r.jobId);
      const head: unknown[] = [JobStatus.PENDING, options.now, options.now];
      await run(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.RETRY_ATTEMPT} = 0, ` +
          `${JobColumn.START_AFTER} = ${this.ph(1)}, ${JobColumn.FAILED_AT} = NULL, ${JobColumn.FAILURE_MESSAGE} = NULL, ` +
          `${JobColumn.COMPLETED_AT} = NULL, ${JobColumn.STARTED_AT} = NULL, ${JobColumn.CANCELLED_AT} = NULL, ` +
          `${JobColumn.EXPIRED_AT} = NULL, ${JobColumn.RETURN_VALUE} = NULL, ${JobColumn.LOCKED_UNTIL} = NULL, ` +
          `${JobColumn.UPDATED_AT} = ${this.ph(2)} WHERE ${JobColumn.ID} IN (${this.phList(ids.length, head.length)})`,
        [...head, ...ids],
      );
      return refs.map((ref) => ({ ...ref, status: JobStatus.PENDING, startAfter: options.now }));
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
   * matched in SQL across the five fields an operator triages by — including the CLOB payload,
   * which Oracle's `LIKE` handles directly.
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
    const params: unknown[] = [this.boolIn(true), options.now];
    const sql =
      `SELECT * FROM ${this.t(TableName.SCHEDULE)} WHERE ${ScheduleColumn.ENABLED} = ${this.ph(0)} ` +
      `AND ${ScheduleColumn.NEXT_RUN_AT} IS NOT NULL AND ${ScheduleColumn.NEXT_RUN_AT} <= ${this.ph(1)} ` +
      `ORDER BY ${ScheduleColumn.NEXT_RUN_AT} ASC` +
      this.fetchFirst(options.limit, params);
    const res = await this.runMaybeTx(sql, params);
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
    return this.inTx(options.tx, async (run) => {
      const sel = await run(
        `SELECT ${JobColumn.ID}, ${JobColumn.QUEUE_NAME} FROM ${this.t(TableName.JOB)} ` +
          `WHERE ${JobColumn.ID} IN (${this.phList(options.jobIds.length)}) ` +
          `AND ${JobColumn.STATUS} IN (${this.phList(2, options.jobIds.length)}) FOR UPDATE`,
        [...options.jobIds, JobStatus.PENDING, JobStatus.RETRY],
      );
      if (!sel.rows.length) return [];
      const refs = sel.rows.map((r) => this.mapJobRef(r));
      const ids = refs.map((r) => r.jobId);
      await run(
        `UPDATE ${this.t(TableName.JOB)} SET ${JobColumn.STATUS} = ${this.ph(0)}, ${JobColumn.CANCELLED_AT} = ${this.ph(1)}, ` +
          `${JobColumn.UPDATED_AT} = ${this.ph(2)}, ${JobColumn.LOCKED_UNTIL} = NULL ` +
          `WHERE ${JobColumn.ID} IN (${this.phList(ids.length, 3)})`,
        [JobStatus.CANCELLED, options.now, options.now, ...ids],
      );
      return refs;
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
    // Never delete a running job — an ACTIVE row belongs to a live handler, so it is skipped and
    // simply absent from the result; cancel it first.
    return this.inTx(options.tx, async (run) => {
      const sel = await run(
        `SELECT ${JobColumn.ID}, ${JobColumn.QUEUE_NAME} FROM ${this.t(TableName.JOB)} ` +
          `WHERE ${JobColumn.ID} IN (${this.phList(options.jobIds.length)}) ` +
          `AND ${JobColumn.STATUS} <> ${this.ph(options.jobIds.length)} FOR UPDATE`,
        [...options.jobIds, JobStatus.ACTIVE],
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
    // No row-set RETURNING: update, then read the row back in the same transaction.
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
    // Get-or-create with Oracle's own conflict-free form: `MERGE … WHEN NOT MATCHED THEN INSERT`,
    // whose target is the primary key, so a concurrent create is a no-op rather than an error.
    // Queue options are process-local; only the pause flags are ever persisted, so an existing row
    // is never rewritten from here (there is deliberately no `WHEN MATCHED` branch).
    return this.inTx(options.tx, async (run) => {
      await run(
        `MERGE INTO ${this.t(TableName.QUEUE)} t ` +
          `USING (SELECT ${this.ph(0)} AS ${QueueColumn.NAME} FROM dual) s ` +
          `ON (t.${QueueColumn.NAME} = s.${QueueColumn.NAME}) ` +
          `WHEN NOT MATCHED THEN INSERT (${QueueColumn.NAME}, ${QueueColumn.PROCESSING_PAUSED}, ` +
          `${QueueColumn.ACCEPTING_PAUSED}, ${QueueColumn.CREATED_AT}, ${QueueColumn.UPDATED_AT}) ` +
          `VALUES (s.${QueueColumn.NAME}, ${this.ph(1)}, ${this.ph(2)}, ${this.ph(3)}, ${this.ph(4)})`,
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
    // Update-first, then MERGE the row in if it was absent, then read it back. The read-back is
    // what the caller takes `processingPaused` from, so there is no query after this transaction.
    // The pause flag is never written here — it is controlled independently.
    const m = options.metrics;
    return this.inTx(undefined, async (run) => {
      const updated = await run(
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
      if (updated.rowCount === 0) {
        await run(
          `MERGE INTO ${this.t(TableName.INSTANCE)} t ` +
            `USING (SELECT ${this.ph(0)} AS ${InstanceColumn.INSTANCE_KEY} FROM dual) s ` +
            `ON (t.${InstanceColumn.INSTANCE_KEY} = s.${InstanceColumn.INSTANCE_KEY}) ` +
            `WHEN NOT MATCHED THEN INSERT (${InstanceColumn.INSTANCE_KEY}, ${InstanceColumn.PROCESSING_PAUSED}, ` +
            `${InstanceColumn.CREATED_AT}, ${InstanceColumn.UPDATED_AT}, ${InstanceColumn.LAST_SEEN_AT}, ` +
            `${InstanceColumn.CPU_PERCENT}, ${InstanceColumn.MEMORY_PERCENT}) ` +
            `VALUES (s.${InstanceColumn.INSTANCE_KEY}, ${this.ph(1)}, ${this.ph(2)}, ${this.ph(3)}, ${this.ph(4)}, ${this.ph(5)}, ${this.ph(6)})`,
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
      }
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
    const fetch = this.fetchFirst(options.limit, params);
    // Bounded batch. Oracle has no `LIMIT`, so the bound is `FETCH FIRST n ROWS ONLY` on the
    // subquery that picks the ids.
    const res = await this.runMaybeTx(
      `DELETE FROM ${this.t(TableName.JOB)} WHERE ${JobColumn.ID} IN ` +
        `(SELECT ${JobColumn.ID} FROM ${this.t(TableName.JOB)} WHERE ${where}${fetch})`,
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
      `${JobColumn.RETENTION_TTL_SECONDS} IS NOT NULL ` +
      `AND ${JobColumn.STATUS} IN (${statusPh}) ` +
      `AND (${JobColumn.RETENTION_STATUSES} IS NULL OR ${scoped.join(' OR ')}) ` +
      `AND (COALESCE(${JobColumn.COMPLETED_AT}, ${JobColumn.FAILED_AT}, ${JobColumn.CANCELLED_AT}, ` +
      `${JobColumn.EXPIRED_AT}, ${JobColumn.UPDATED_AT}) + ${JobColumn.RETENTION_TTL_SECONDS} * 1000) <= ${cutoffPh}`
    );
  }

  // --- Pub/sub (interval polling instead of LISTEN/NOTIFY) ---
  async notify(_options: { channel: string; payload: string }): Promise<void> {
    // No-op: this driver does not use Oracle AQ; subscribers rely on interval polling.
  }

  async subscribe(_options: {
    channel: string;
    onNotification: (payload: string) => void;
  }): Promise<Subscription> {
    throw new UnsupportedCapabilityError(
      DriverCapability.LISTEN_NOTIFY,
      'The Oracle driver does not use AQ; rely on interval polling instead.',
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
