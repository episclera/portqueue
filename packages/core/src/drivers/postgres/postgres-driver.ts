import { createHash } from 'node:crypto';
import { DatabaseEngine } from '../../options/enums.js';
import { DriverCapability, type DriverCapabilitySet } from '../../driver/driver-capabilities.js';
import { DriverConnectionError, MissingPeerDependencyError } from '../../errors/errors.js';
import { PgDialectDriver } from '../shared/pg-dialect-driver.js';
import type { RawResult, Session } from '../shared/sql-driver.js';
import type { Subscription } from '../../driver/driver.interface.js';

export interface PostgresDriverOptions {
  connectionString?: string;
  /** An existing `pg.Pool` to share with the app. */
  pool?: unknown;
  /** Any `pg.PoolConfig` (host/user/password/database/…). */
  config?: Record<string, unknown>;
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

/**
 * Postgres driver — the full-feature reference driver. LISTEN/NOTIFY
 * on a dedicated connection, advisory locks for leader-only tasks, SKIP LOCKED claiming.
 * The `pg` package is an optional peer dependency.
 */
export class PostgresDriver extends PgDialectDriver {
  readonly engine = DatabaseEngine.POSTGRES;
  readonly capabilities: DriverCapabilitySet = this.pgCapabilities({
    [DriverCapability.LISTEN_NOTIFY]: true,
    [DriverCapability.ADVISORY_LOCK]: true,
  });

  private pool: PgPool | null = null;
  private listenClient: PgClient | null = null;
  private readonly listeners = new Map<string, Set<(payload: string) => void>>();
  private readonly options: PostgresDriverOptions;

  constructor(options: PostgresDriverOptions = {}) {
    super();
    this.options = options;
  }

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

  // --- LISTEN/NOTIFY ---
  private channel(name: string): string {
    // Sanitize to a safe channel token — hash arbitrary names.
    const token = createHash('sha1')
      .update(`${this.context.namespace}:${name}`)
      .digest('hex')
      .slice(0, 40);
    return `pq_${token}`;
  }

  override async notify(options: { channel: string; payload: string }): Promise<void> {
    if (!this.pool) return;
    await this.pool.query('SELECT pg_notify($1, $2)', [
      this.channel(options.channel),
      options.payload.slice(0, 7000),
    ]);
  }

  override async subscribe(options: {
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

  override async probe(): Promise<{
    serverVersion: string;
    verifiedCapabilities: DriverCapability[];
  }> {
    let serverVersion = 'unknown';
    if (this.pool) {
      const res = await this.pool.query('SHOW server_version');
      serverVersion = String(res.rows[0]?.server_version ?? 'unknown');
    }
    return { serverVersion, verifiedCapabilities: this.enabledCapabilities() };
  }
}

/** Map a string key to a 63-bit advisory-lock integer. */
function advisoryKey(key: string): number {
  const hash = createHash('sha1').update(key).digest();
  // Use 6 bytes to stay within a safe JS integer.
  return hash.readUIntBE(0, 6);
}
