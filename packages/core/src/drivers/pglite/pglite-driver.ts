import { DatabaseEngine } from '../../options/enums';
import { capabilities, DriverCapability, type DriverCapabilitySet } from '../driver-capabilities';
import {
  DriverConnectionError,
  MissingPeerDependencyError,
  UnsupportedCapabilityError,
} from '../../errors/errors';
import { toMigrationSteps } from '../shared/migration';
import { PGLITE_MIGRATIONS } from './migrations';
import type { Driver, DriverProbe, MigrationStep, Subscription } from '../driver.interface';
// --- Compatible with Postgres: the whole SQL surface is inherited ---
// PGLite is Postgres compiled to WASM and speaks the same wire protocol and dialect, so every
// query method (jobs, queues, schedules, instances, claiming, retention, paging, the tx handle)
// comes from `PostgresDriver` unchanged. `RawResult`/`Session` are its own connection-level types,
// imported so the overrides below stay signature-compatible.
import { PostgresDriver, type RawResult, type Session } from '../postgres/postgres-driver';

/**
 * Options for {@link PgliteDriver} — entirely custom to PGLite: there is no host, port, user or
 * pool, only an optional on-disk directory. `schema`/`tablePrefix`/`namespace` mean exactly what
 * they mean for Postgres and are forwarded to the base driver's `DriverContext`.
 */
export interface PGliteDriverOptions {
  /** Data directory for a file-backed DB; omit for in-memory. */
  dataDir?: string;
  /** DB schema for all objects. Created by the migration and used to qualify every table name. */
  schema?: string;
  /** Prefix for all created tables (default 'pq_'). */
  tablePrefix?: string;
  /** Logical prefix for pub/sub channels when multiple PortQueues share one DB. */
  namespace?: string;
}

// --- Custom to PGLite: the client shape ---
// The `@electric-sql/pglite` client is nothing like `pg` — one in-process instance instead of a
// pool, a callback-style `transaction()` instead of BEGIN/COMMIT on a checked-out connection, and
// `affectedRows` instead of `rowCount`.
export interface PGliteQueryable {
  query(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; affectedRows?: number }>;
}
export interface PGliteInstance extends PGliteQueryable {
  transaction<T>(fn: (tx: PGliteQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * PGLite driver — Postgres compiled to WASM, running in-process. Primarily for embedded/edge use
 * and tests.
 *
 * Because PGLite is byte-for-byte PG-wire compatible, this class **extends `PostgresDriver`** and
 * inherits its entire SQL surface: `$1`-style placeholders, SKIP LOCKED claiming, RETURNING
 * everywhere, the keys and indexes its migration creates, no relational JOIN (relationships resolve
 * by name/key lookups), and the in-code enforcement of idempotency/singleton dedup. A change to a
 * query in `PostgresDriver` therefore changes PGLite too; anything that must differ is overridden
 * here.
 *
 * What is custom to PGLite and overridden below:
 * - `engine`/`capabilities`/`migrations` — its own identity, capability set and migration array.
 * - `connect`/`disconnect` — boots one in-process WASM instance from `@electric-sql/pglite`
 *   (an optional peer) instead of opening a `pg.Pool`.
 * - `execute`/`transaction` — talks to that instance and uses its callback-style `transaction()`.
 * - `probe` — no `SHOW server_version` round-trip; the version is the fixed string `'pglite'`.
 * - `notify`/`subscribe` — LISTEN/NOTIFY is off: PGLite is in-process with no shared bus, so the
 *   interval poller is the backstop.
 * - `tryAdvisoryLock`/`releaseAdvisoryLock` — inert, since a single in-process DB has nothing to
 *   coordinate with.
 */
export class PgliteDriver extends PostgresDriver implements Driver {
  override readonly engine: DatabaseEngine = DatabaseEngine.PGLITE;
  /** Same as Postgres minus LISTEN/NOTIFY and advisory locks — neither is meaningful in-process. */
  override readonly capabilities: DriverCapabilitySet = capabilities({
    [DriverCapability.SKIP_LOCKED]: true,
    [DriverCapability.RETURNING]: true,
    [DriverCapability.TRANSACTIONS]: true,
  });
  override readonly migrations: MigrationStep[] = toMigrationSteps(PGLITE_MIGRATIONS);

  private db: PGliteInstance | null = null;
  private readonly dataDir: string | undefined;

  constructor(options: PGliteDriverOptions = {}) {
    // Forward only the naming options; PGLite has no connection string, pool or pg config.
    super({
      ...(options.tablePrefix !== undefined ? { tablePrefix: options.tablePrefix } : {}),
      ...(options.schema !== undefined ? { schema: options.schema } : {}),
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
    });
    this.dataDir = options.dataDir;
  }

  // --- Connection management (custom to PGLite) ---
  override async connect(): Promise<void> {
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

  override async disconnect(): Promise<void> {
    await this.db?.close();
    this.db = null;
  }

  protected override async execute(
    sql: string,
    params: readonly unknown[],
    session?: Session,
  ): Promise<RawResult> {
    const target = (session as PGliteQueryable | undefined) ?? this.db;
    if (!target) throw new DriverConnectionError('PGLite driver is not connected.');
    const res = await target.query(sql, params);
    // PGLite reports mutations as `affectedRows`, not `rowCount`.
    return { rows: res.rows ?? [], rowCount: res.affectedRows ?? res.rows?.length ?? 0 };
  }

  protected override async transaction<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    if (!this.db) throw new DriverConnectionError('PGLite driver is not connected.');
    // The client owns BEGIN/COMMIT/ROLLBACK — no connection to check out and release.
    return this.db.transaction((tx) => fn(tx));
  }

  // --- Probe (custom to PGLite: no server to ask for a version) ---
  override async probe(): Promise<DriverProbe> {
    return { serverVersion: 'pglite', verifiedCapabilities: this.enabledCapabilities() };
  }

  // --- Pub/sub (custom to PGLite: LISTEN/NOTIFY disabled — an interval poll is the backstop) ---
  // No-op: PGLite runs in-process without a shared LISTEN/NOTIFY bus; the poller drives progress.
  override async notify(_options: { channel: string; payload: string }): Promise<void> {}

  override async subscribe(_options: {
    channel: string;
    onNotification: (payload: string) => void;
  }): Promise<Subscription> {
    throw new UnsupportedCapabilityError(
      DriverCapability.LISTEN_NOTIFY,
      'PGLite has no shared notification bus; rely on interval polling instead.',
    );
  }

  // --- Advisory locks (custom to PGLite: inert) ---
  // A single in-process DB has no second process to coordinate with, so the migration runner takes
  // no lock — it skips these entirely because ADVISORY_LOCK is off in `capabilities`. They stay
  // declared, and inert, so Postgres' pool-backed implementations can never be inherited.
  override async tryAdvisoryLock(_options: { key: string }): Promise<boolean> {
    return false;
  }

  override async releaseAdvisoryLock(_options: { key: string }): Promise<void> {}
}
