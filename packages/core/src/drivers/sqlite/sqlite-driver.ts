import { DatabaseEngine } from '../../options/enums.js';
import {
  capabilities,
  DriverCapability,
  type DriverCapabilitySet,
} from '../../driver/driver-capabilities.js';
import { DriverConnectionError, MissingPeerDependencyError } from '../../errors/errors.js';
import { SqlDriver, type RawResult, type Session } from '../shared/sql-driver.js';

export interface SqliteDriverOptions {
  /** File path, or `:memory:` (default) for an in-process database. */
  path?: string;
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

/**
 * SQLite driver (build_plan/11.3). Uses Node's built-in `node:sqlite` (no native dep).
 * No LISTEN/NOTIFY (interval polling) and no SKIP LOCKED (SQLite's single-writer model
 * makes the guarded-UPDATE claim naturally exclusive). App-generated UUIDs.
 */
export class SqliteDriver extends SqlDriver {
  readonly engine = DatabaseEngine.SQLITE;
  readonly capabilities: DriverCapabilitySet = capabilities({
    [DriverCapability.RETURNING]: true,
    [DriverCapability.UPSERT]: true,
    [DriverCapability.TRANSACTIONS]: true,
  });
  protected readonly placeholderStyle = 'question' as const;

  private db: SqliteDatabase | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private readonly path: string;

  constructor(options: SqliteDriverOptions = {}) {
    super();
    this.path = options.path ?? ':memory:';
  }

  async connect(): Promise<void> {
    let mod: { DatabaseSync: new (path: string) => SqliteDatabase };
    try {
      mod = (await import('node:sqlite')) as unknown as {
        DatabaseSync: new (path: string) => SqliteDatabase;
      };
    } catch {
      throw new MissingPeerDependencyError(
        'node:sqlite (Node 22+, run with a recent Node)',
        'SQLite',
      );
    }
    try {
      this.db = new mod.DatabaseSync(this.path);
      this.db.exec('PRAGMA journal_mode=WAL;');
      this.db.exec('PRAGMA busy_timeout=5000;');
      this.db.exec('PRAGMA foreign_keys=ON;');
    } catch (err) {
      throw new DriverConnectionError(`Failed to open SQLite database '${this.path}'.`, err);
    }
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  /** Serialize all access (node:sqlite is synchronous; transactions must not interleave). */
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
}

/** Sentinel marking "run on the current transaction connection" for the single-conn driver. */
const TX_SESSION = Symbol('sqlite-tx');
