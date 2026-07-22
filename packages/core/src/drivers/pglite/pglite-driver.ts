import { DatabaseEngine } from '../../options/enums.js';
import { DriverCapability, type DriverCapabilitySet } from '../../driver/driver-capabilities.js';
import { DriverConnectionError, MissingPeerDependencyError } from '../../errors/errors.js';
import { PgDialectDriver } from '../shared/pg-dialect-driver.js';
import type { RawResult, Session } from '../shared/sql-driver.js';

export interface PGliteDriverOptions {
  /** Data directory for a file-backed DB; omit for in-memory. */
  dataDir?: string;
}

interface PGliteQueryable {
  query(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; affectedRows?: number }>;
}
interface PGliteInstance extends PGliteQueryable {
  transaction<T>(fn: (tx: PGliteQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * PGLite driver (build_plan/11.2) — Postgres compiled to WASM, in-process. Shares the
 * Postgres dialect (SKIP LOCKED, RETURNING, UPSERT, transactions). Primarily for
 * embedded/edge use and tests. LISTEN/NOTIFY is left off (polling backstop is used).
 */
export class PgliteDriver extends PgDialectDriver {
  readonly engine = DatabaseEngine.PGLITE;
  readonly capabilities: DriverCapabilitySet = this.pgCapabilities();

  private db: PGliteInstance | null = null;
  private readonly dataDir: string | undefined;

  constructor(options: PGliteDriverOptions = {}) {
    super();
    this.dataDir = options.dataDir;
  }

  async connect(): Promise<void> {
    let mod: { PGlite: new (dataDir?: string) => PGliteInstance };
    try {
      mod = (await import('@electric-sql/pglite')) as unknown as {
        PGlite: new (dataDir?: string) => PGliteInstance;
      };
    } catch {
      throw new MissingPeerDependencyError('@electric-sql/pglite', 'PGLite');
    }
    try {
      this.db = this.dataDir ? new mod.PGlite(this.dataDir) : new mod.PGlite();
      // Force the WASM instance to finish booting with a trivial query.
      await this.db.query('SELECT 1');
    } catch (err) {
      throw new DriverConnectionError('Failed to initialize PGLite.', err);
    }
  }

  async disconnect(): Promise<void> {
    await this.db?.close();
    this.db = null;
  }

  protected async execute(
    sql: string,
    params: readonly unknown[],
    session?: Session,
  ): Promise<RawResult> {
    const target = (session as PGliteQueryable | undefined) ?? this.db;
    if (!target) throw new DriverConnectionError('PGLite driver is not connected.');
    const res = await target.query(sql, params);
    return { rows: res.rows ?? [], rowCount: res.affectedRows ?? res.rows?.length ?? 0 };
  }

  protected async transaction<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    if (!this.db) throw new DriverConnectionError('PGLite driver is not connected.');
    return this.db.transaction((tx) => fn(tx));
  }

  override async probe(): Promise<{
    serverVersion: string;
    verifiedCapabilities: DriverCapability[];
  }> {
    return { serverVersion: 'pglite', verifiedCapabilities: this.enabledCapabilities() };
  }
}
