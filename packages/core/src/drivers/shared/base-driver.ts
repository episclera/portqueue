import { BackoffStrategy, RetentionMode } from '../../options/enums';
import { JobStatus } from '../../jobs/job-state.enum';
import { DriverCapability, type DriverCapabilitySet } from '../driver-capabilities';
import { DriverContext } from '../driver-context';
import { InstanceColumn, JobColumn, QueueColumn, ScheduleColumn, TableName } from '../table-names';
import { decodeRetentionStatuses, encodeRetentionStatuses } from './retention-statuses';
import { matchesInstance } from '../../jobs/instance-affinity';
import { uuid } from '../../util/uuid';
import { secondsToMs } from '../../util/seconds';
import {
  AFFINITY_MAX_PAGES,
  AFFINITY_MIN_SCAN,
  AFFINITY_PAGE_FACTOR,
  AFFINITY_PAGE_MAX,
  AFFINITY_PAGE_MIN_HEADROOM,
} from '../../constants';
import type {
  InstanceRow,
  JobRecord,
  NewJobRecord,
  QueueRow,
  ScheduledJobOptions,
  ScheduleRow,
} from '../../jobs/job-record';
import type { PageWindow } from '../driver.interface';
import type { TransactionHandle, TxQueryResult } from '../../tx/transaction-handle';

/** A raw query result, normalized across every client library. */
export interface RawResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

/** An opaque per-connection handle a driver threads through one transaction. */
export type Session = unknown;

/** One row as the client library handed it over, keys already lower-cased. */
export type Row = Record<string, unknown>;

/**
 * Every `job` column, in the order {@link BaseDriver.jobInsertValues} produces values for. Shared
 * because it is the *shape of a row*, not SQL: a column added to the schema must appear in the
 * insert of every engine, and one list makes that impossible to forget.
 */
export const JOB_COLUMNS: readonly JobColumn[] = [
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
  JobColumn.RETENTION_STATUSES,
  JobColumn.IDEMPOTENCY_KEY,
  JobColumn.SCHEDULE_ID,
  JobColumn.SINGLETON_KEY,
];

/** The columns a schedule insert writes, in {@link BaseDriver.scheduleInsertValues} order. */
export const SCHEDULE_INSERT_COLUMNS: readonly ScheduleColumn[] = [
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

/**
 * What every driver shares — and **only** what every driver shares.
 *
 * The duplicate-over-share rule in CLAUDE.md is about *dialect and query SQL*: a change to one
 * engine's statement must never leak into another's. None of that lives here. What does live here is
 * the same category as `TableName`, the `MigrationRunner` and the value objects — row → record
 * mapping, value conversion, id generation, the affinity filter, and the paging arithmetic:
 *
 * - **Mapping** (`mapJob`, `mapQueue`, `mapSchedule`, `mapInstance`) turns a result row into the
 *   record shape core consumes. It contains no SQL and cannot: it reads a `Row` by column name.
 *   Duplicating it bought nothing and cost a real bug — a column added to the schema had to be
 *   remembered in five files, and `retention_statuses` would have been missed in at least one.
 * - **Value conversion** (`toJson`, `boolIn`, `numOrNull`, …) is JS-side normalization of what a
 *   client library hands back.
 * - **Insert values** (`jobInsertValues`) is the ordered value list matching {@link JOB_COLUMNS}.
 *   Each driver still writes its own `INSERT` statement around it.
 * - **The affinity scan** (`affinityPlan`, `matchAffinity`) is the paging arithmetic and the regex
 *   test. The driver supplies the `SELECT` — the part that is dialect.
 *
 * Everything a subclass must provide is abstract: the connection (`execute`, `transaction`),
 * the placeholder style (`ph`), and the paging tail (`window`). No statement string appears below.
 */
export abstract class BaseDriver {
  abstract readonly capabilities: DriverCapabilitySet;
  readonly context: DriverContext;

  /**
   * The most bound parameters this engine accepts in one statement. The default is a floor that
   * every supported engine clears: SQLite's `SQLITE_MAX_VARIABLE_NUMBER` (32766 on a modern build),
   * Postgres' 16-bit parameter index (65535) and MySQL's `max_prepared_stmt_count` are all above it.
   * A driver whose engine is tighter — Oracle's `INSERT ALL` — lowers it.
   */
  protected readonly maxBindParams: number = 30_000;

  protected constructor(options: {
    tablePrefix?: string;
    schema?: string;
    namespace?: string;
    maxIdentifierLen?: number;
  }) {
    this.context = new DriverContext(options);
  }

  // --- Connection mechanism (each engine's own) ---

  /** Run one statement, on `session`'s connection when inside a transaction. */
  protected abstract execute(
    sql: string,
    params: readonly unknown[],
    session?: Session,
  ): Promise<RawResult>;

  /** Run `fn` inside one transaction, handing it the session its statements must use. */
  protected abstract transaction<T>(fn: (session: Session) => Promise<T>): Promise<T>;

  /** This engine's placeholder for the 0-based parameter at `index0` (`$1`, `?`, `:1`, …). */
  protected abstract ph(index0: number): string;

  /**
   * The trailing paging clause for a list read, appending each bound value to `params`. Dialect —
   * `LIMIT/OFFSET` on most engines, `OFFSET … ROWS FETCH NEXT … ROWS ONLY` on Oracle — so each
   * driver writes its own. Returns `''` when the caller asked for no window, so core's unpaged
   * reads emit no paging clause at all.
   */
  protected abstract window(page: PageWindow, params: unknown[]): string;

  // --- Naming ---

  /** The name a statement must reference: schema-qualified when a `schema` was configured. */
  protected t(table: TableName): string {
    return this.context.tableNames.qualified(table);
  }

  /**
   * Run one statement: on the caller's transaction when there is one, otherwise on its own.
   *
   * A lone statement needs no explicit `BEGIN` — every engine here runs it inside an implicit
   * transaction, so it is already all-or-nothing. What must never happen is a *sequence* of
   * statements outside a transaction; that is what {@link inTx} is for, and every multi-statement
   * driver method goes through it.
   */
  protected async runMaybeTx(
    sql: string,
    params: readonly unknown[],
    tx?: TransactionHandle,
  ): Promise<RawResult> {
    if (tx) {
      const res: TxQueryResult = await tx.execute(sql, [...params]);
      return { rows: res.rows, rowCount: res.rowCount };
    }
    return this.execute(sql, params);
  }

  /**
   * Run several statements as one unit: the caller's transaction when there is one, otherwise a
   * fresh one of ours. `run` issues each statement on whichever connection is correct.
   *
   * Every driver method that reads then writes — get-or-create, the dedup-plus-insert pair, the
   * heartbeat's update-then-insert, a claim's scan-then-update — uses this. Outside a transaction
   * those pairs can interleave with another instance's; inside one they cannot.
   */
  protected async inTx<T>(
    tx: TransactionHandle | undefined,
    fn: (run: (sql: string, params: readonly unknown[]) => Promise<RawResult>) => Promise<T>,
  ): Promise<T> {
    if (tx) {
      return fn(async (sql, params) => {
        const res = await tx.execute(sql, [...params]);
        return { rows: res.rows, rowCount: res.rowCount };
      });
    }
    return this.transaction((session) => fn((sql, params) => this.execute(sql, params, session)));
  }

  /** The capability keys this driver declares as on — what `probe()` reports as verified. */
  protected enabledCapabilities(): DriverCapability[] {
    return (Object.keys(this.capabilities) as DriverCapability[]).filter(
      (cap) => this.capabilities[cap],
    );
  }

  /** A comma-separated placeholder list for `count` params starting at `from`. */
  protected phList(count: number, from = 0): string {
    return Array.from({ length: count }, (_, i) => this.ph(from + i)).join(', ');
  }

  /**
   * Split a batch so no single statement exceeds this engine's bound-parameter limit.
   *
   * A multi-row insert binds every column of every row, so a batch of a thousand jobs is tens of
   * thousands of parameters — past SQLite's `SQLITE_MAX_VARIABLE_NUMBER` and Postgres' 16-bit
   * parameter index. The caller loops over the chunks; each is still one round trip, so a large
   * batch costs `ceil(rows / chunk)` statements instead of `rows`.
   */
  protected chunkForBind<T>(items: T[], paramsPerItem: number): T[][] {
    const perChunk = Math.max(1, Math.floor(this.maxBindParams / Math.max(paramsPerItem, 1)));
    if (items.length <= perChunk) return [items];
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += perChunk) chunks.push(items.slice(i, i + perChunk));
    return chunks;
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

  protected strOrNull(value: unknown): string | null {
    return value == null ? null : String(value);
  }

  /** A fresh application-generated id. Every engine stores ids as strings. */
  protected newId(): string {
    return uuid();
  }

  /** A lock deadline `lockDurationSeconds` from `now` (negative releases the lock). */
  protected lockDeadline(now: number, lockDurationSeconds: number): number {
    return now + secondsToMs(lockDurationSeconds, 'limiter.lockDurationSeconds');
  }

  /**
   * A bound `LIKE` pattern for a case-insensitive substring search. The term is lower-cased (the
   * column is too, at the query site) and `%`/`_`/`!` are escaped with `!` — declared by the
   * query's own `ESCAPE '!'` — so a user typing `100%` searches for that text rather than matching
   * everything. Still a bound parameter: nothing here is interpolated into SQL.
   */
  protected likePattern(term: string): string {
    const escaped = term.toLowerCase().replace(/[!%_]/g, (ch) => `!${ch}`);
    return `%${escaped}%`;
  }

  /** A zeroed status breakdown, for a key a grouped count query returned nothing for. */
  protected emptyStatusCounts(): Record<JobStatus, number> {
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

  // --- Row → record mapping ---

  protected mapJob(row: Row): JobRecord {
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
      retentionStatuses: decodeRetentionStatuses(row[JobColumn.RETENTION_STATUSES]),
      idempotencyKey: this.strOrNull(row[JobColumn.IDEMPOTENCY_KEY]),
      scheduleId: this.strOrNull(row[JobColumn.SCHEDULE_ID]),
      singletonKey: this.strOrNull(row[JobColumn.SINGLETON_KEY]),
    };
  }

  protected mapQueue(row: Row): QueueRow {
    return {
      name: String(row[QueueColumn.NAME]),
      processingPaused: this.boolOut(row[QueueColumn.PROCESSING_PAUSED]),
      acceptingPaused: this.boolOut(row[QueueColumn.ACCEPTING_PAUSED]),
      createdAt: Number(row[QueueColumn.CREATED_AT]),
      updatedAt: Number(row[QueueColumn.UPDATED_AT]),
    };
  }

  protected mapInstance(row: Row): InstanceRow {
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

  protected mapSchedule(row: Row): ScheduleRow {
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

  /** A job's ref as the mutating methods return it. */
  protected mapJobRef(row: Row): { jobId: string; queueName: string } {
    return {
      jobId: String(row[JobColumn.ID]),
      queueName: String(row[JobColumn.QUEUE_NAME]),
    };
  }

  /** A schedule's ref as the mutating methods return it. */
  protected mapScheduleRef(row: Row): { scheduleId: string; queueName: string } {
    return {
      scheduleId: String(row[ScheduleColumn.ID]),
      queueName: String(row[ScheduleColumn.QUEUE_NAME]),
    };
  }

  // --- Insert value lists ---

  /** The ordered values for one job row, matching {@link JOB_COLUMNS} exactly. */
  protected jobInsertValues(job: NewJobRecord): { id: string; values: unknown[] } {
    const id = job.id ?? this.newId();
    const now = job.createdAt;
    return {
      id,
      values: [
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
        encodeRetentionStatuses(job.retentionStatuses),
        job.idempotencyKey,
        job.scheduleId,
        job.singletonKey,
      ],
    };
  }

  /** The ordered values for one schedule row, matching {@link SCHEDULE_INSERT_COLUMNS}. */
  protected scheduleInsertValues(
    schedule: import('../../jobs/job-record').NewScheduleRow,
    now: number,
  ): { id: string; values: unknown[] } {
    const id = schedule.id ?? this.newId();
    return {
      id,
      values: [
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
      ],
    };
  }

  // --- Multi-instance affinity ---

  /**
   * The page size and scan ceiling for the multi-instance claim scan.
   *
   * Affinity is a regex and portable SQL cannot evaluate one, so a named instance selects
   * candidates highest-priority-first and filters them here. Paging — rather than one capped
   * window — prevents starvation: when the top rows all target other instances, the jobs this
   * instance *can* run may sit past the first page. The ceiling stops a backlog of
   * exclusively-non-matching jobs from turning one tick into a full-table sweep; the next tick
   * resumes from the top.
   */
  protected affinityPlan(limit: number): { pageSize: number; maxScan: number } {
    const pageSize = Math.min(
      Math.max(limit * AFFINITY_PAGE_FACTOR, limit + AFFINITY_PAGE_MIN_HEADROOM),
      AFFINITY_PAGE_MAX,
    );
    return { pageSize, maxScan: Math.max(pageSize * AFFINITY_MAX_PAGES, AFFINITY_MIN_SCAN) };
  }

  /**
   * Collect the ids from one candidate page this instance's key is allowed to run, stopping at
   * `limit`. Returns whether the caller should keep paging.
   */
  protected collectAffinityMatches(
    rows: Row[],
    instanceKey: string,
    limit: number,
    into: Set<string>,
  ): void {
    for (const row of rows) {
      const pattern = this.strOrNull(row[JobColumn.PREFERRED_INSTANCE_KEY_PATTERN]);
      if (!matchesInstance(pattern, instanceKey)) continue;
      into.add(String(row[JobColumn.ID]));
      if (into.size >= limit) return;
    }
  }

  /** Claim order: highest priority first, then oldest due. Applied after a claim returns rows. */
  protected sortClaimed(jobs: JobRecord[]): JobRecord[] {
    return jobs.sort((a, b) => b.priority - a.priority || a.startAfter - b.startAfter);
  }
}
