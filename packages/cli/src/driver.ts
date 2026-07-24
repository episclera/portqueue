import { PortQueue } from '@portqueue/core';
import type { Driver } from '@portqueue/core';
import { CliError } from './errors';

/** The engines the CLI can construct a driver for. */
export enum CliEngine {
  POSTGRES = 'postgres',
  PGLITE = 'pglite',
  SQLITE = 'sqlite',
  MYSQL = 'mysql',
  ORACLE = 'oracle',
}

/** Flags that describe how to connect to the database. */
export interface DriverFlags {
  driver?: string | undefined;
  connectionString?: string | undefined;
  schema?: string | undefined;
  tablePrefix?: string | undefined;
  namespace?: string | undefined;
}

/** Engines whose connection string carries their own URL scheme. */
const SCHEME_TO_ENGINE: Record<string, CliEngine> = {
  postgres: CliEngine.POSTGRES,
  postgresql: CliEngine.POSTGRES,
  mysql: CliEngine.MYSQL,
  oracle: CliEngine.ORACLE,
  sqlite: CliEngine.SQLITE,
  file: CliEngine.SQLITE,
};

const KNOWN_ENGINES = new Set<string>(Object.values(CliEngine));

/**
 * Builds the CLI's own short-lived PortQueue from connection flags. It never loads the user's
 * app config: it constructs a driver from `--driver`/`--connection-string` (or `DATABASE_URL`)
 * and returns a client with `monitor: false`, no `instanceKey`, and no workers.
 */
export async function buildPortQueue(flags: DriverFlags): Promise<PortQueue> {
  const connectionString = flags.connectionString ?? process.env.DATABASE_URL;
  const engine = resolveEngine(flags.driver, connectionString);
  const driver = await createDriver(engine, connectionString, flags);
  return new PortQueue({ driver, monitor: false });
}

/** Determines the engine from `--driver`, else infers it from the connection string scheme. */
function resolveEngine(driver: string | undefined, connectionString: string | undefined): CliEngine {
  if (driver) {
    const normalized = driver.toLowerCase();
    if (!KNOWN_ENGINES.has(normalized)) {
      throw new CliError(
        `Unknown --driver '${driver}'. Expected one of: ${Object.values(CliEngine).join(', ')}.`,
      );
    }
    return normalized as CliEngine;
  }

  const scheme = connectionString ? schemeOf(connectionString) : undefined;
  if (scheme && SCHEME_TO_ENGINE[scheme]) return SCHEME_TO_ENGINE[scheme]!;

  throw new CliError(
    `Cannot determine the database engine. Pass --driver <${Object.values(CliEngine).join('|')}>, ` +
      `or supply a connection string whose scheme names the engine ` +
      `(postgres://, postgresql://, mysql://, oracle://, sqlite://, file://). ` +
      `sqlite and pglite have no URL scheme, so they always need --driver.`,
  );
}

/** Extracts the lowercased URL scheme (the part before `://` or `:`). */
function schemeOf(connectionString: string): string | undefined {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(connectionString.trim());
  return match ? match[1]!.toLowerCase() : undefined;
}

/** Only include a storage option when it is actually set (mirrors the optional driver options). */
function storageOptions(flags: DriverFlags): {
  schema?: string;
  tablePrefix?: string;
  namespace?: string;
} {
  return {
    ...(flags.schema !== undefined ? { schema: flags.schema } : {}),
    ...(flags.tablePrefix !== undefined ? { tablePrefix: flags.tablePrefix } : {}),
    ...(flags.namespace !== undefined ? { namespace: flags.namespace } : {}),
  };
}

function requireConnectionString(
  engine: CliEngine,
  connectionString: string | undefined,
): string {
  if (!connectionString) {
    throw new CliError(
      `The ${engine} driver needs a connection string. Pass --connection-string <url> ` +
        `or set DATABASE_URL.`,
    );
  }
  return connectionString;
}

/** Dynamically imports the matching driver subpath and constructs it. */
async function createDriver(
  engine: CliEngine,
  connectionString: string | undefined,
  flags: DriverFlags,
): Promise<Driver> {
  const storage = storageOptions(flags);

  switch (engine) {
    case CliEngine.POSTGRES: {
      const { PostgresDriver } = await import('@portqueue/core/drivers/postgres');
      return new PostgresDriver({
        connectionString: requireConnectionString(engine, connectionString),
        ...storage,
      });
    }
    case CliEngine.MYSQL: {
      const { MysqlDriver } = await import('@portqueue/core/drivers/mysql');
      return new MysqlDriver({
        connectionString: requireConnectionString(engine, connectionString),
        ...storage,
      });
    }
    case CliEngine.ORACLE: {
      const { OracleDriver } = await import('@portqueue/core/drivers/oracle');
      // Oracle's connection option is `connectString`, not `connectionString`.
      return new OracleDriver({
        connectString: requireConnectionString(engine, connectionString),
        ...storage,
      });
    }
    case CliEngine.SQLITE: {
      const { SqliteDriver } = await import('@portqueue/core/drivers/sqlite');
      // SQLite has no URL scheme: the connection string is the file path (`:memory:` by default).
      return new SqliteDriver({
        ...(connectionString !== undefined ? { path: connectionString } : {}),
        ...(storage.tablePrefix !== undefined ? { tablePrefix: storage.tablePrefix } : {}),
        ...(storage.namespace !== undefined ? { namespace: storage.namespace } : {}),
      });
    }
    case CliEngine.PGLITE: {
      const { PgliteDriver } = await import('@portqueue/core/drivers/pglite');
      // PGLite has no URL scheme: the connection string is the dataDir (in-memory when omitted).
      return new PgliteDriver({
        ...(connectionString !== undefined ? { dataDir: connectionString } : {}),
        ...storage,
      });
    }
  }
}
