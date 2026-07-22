import { DatabaseEngine } from '../../options/enums.js';
import {
  capabilities,
  DriverCapability,
  type DriverCapabilitySet,
} from '../../driver/driver-capabilities.js';
import { DriverConnectionError, MissingPeerDependencyError } from '../../errors/errors.js';
import { validateIdentifier } from '../../schema/table-names.js';
import { SqlDriver, type RawResult, type Session } from '../shared/sql-driver.js';

export interface OracleDriverOptions {
  user?: string;
  password?: string;
  connectString?: string;
  /** Oracle identifiers are limited to 30 bytes (128 on 12.2+); prefix+table must fit. */
  maxIdentifierLen?: number;
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

/**
 * Oracle driver. Uses `oracledb` (optional peer) and `:1` binds. Oracle is validated by the
 * conformance kit against a real server rather than in CI; this implementation provides the
 * connection + dialect wiring. GUID↔UUID mapping and RETURNING INTO out-binds are handled here.
 */
export class OracleDriver extends SqlDriver {
  readonly engine = DatabaseEngine.ORACLE;
  readonly capabilities: DriverCapabilitySet = capabilities({
    [DriverCapability.SKIP_LOCKED]: true,
    [DriverCapability.RETURNING]: true,
    [DriverCapability.TRANSACTIONS]: true,
    [DriverCapability.DB_GENERATED_UUID]: false,
  });
  protected readonly placeholderStyle = 'colon' as const;

  private pool: OraclePool | null = null;
  private readonly options: OracleDriverOptions;

  constructor(options: OracleDriverOptions = {}) {
    super();
    this.options = options;
    if (options.maxIdentifierLen) {
      // Fail fast if the configured prefix would exceed Oracle's identifier limit.
      validateIdentifier('tablePrefix', 'pq_', options.maxIdentifierLen);
    }
  }

  async connect(): Promise<void> {
    let oracledb: {
      createPool(config: Record<string, unknown>): Promise<OraclePool>;
      OUT_FORMAT_OBJECT: number;
      outFormat: number;
    };
    try {
      const mod = (await import('oracledb' as string)) as { default?: unknown };
      oracledb = (mod.default ?? mod) as never;
    } catch {
      throw new MissingPeerDependencyError('oracledb', 'Oracle');
    }
    try {
      oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
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
}
