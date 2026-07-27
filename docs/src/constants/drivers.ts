/**
 * Single source of truth for the engines PortQueue ships a driver for, and the
 * package managers we document install commands for. Every docs page renders its
 * driver / package-manager tabs from these constants — never hardcode the list in
 * an individual page, so adding an engine here surfaces it everywhere at once.
 */

export interface DriverInfo {
  /** Stable tab value (also the folder name under drivers/). */
  value: string;
  /** Human label shown on the tab and pills. */
  label: string;
  /** Optional peer dependency installed alongside @portqueue/core. */
  peerDep: string;
  /** Exported driver class name. */
  className: string;
  /** Import specifier for the driver. */
  module: string;
  /** A minimal connect snippet for the driver. */
  connect: string;
  /** Marks the tab selected by default. */
  default?: boolean;
}

const CORE = '@portqueue/core';

export const DRIVERS: DriverInfo[] = [
  {
    value: 'postgres',
    label: 'Postgres',
    peerDep: 'pg',
    className: 'PostgresDriver',
    module: `${CORE}/drivers/postgres`,
    default: true,
    connect: `import { PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

const pq = new PortQueue({
  driver: new PostgresDriver({ connectionString: process.env.DATABASE_URL }),
});
await pq.init();`,
  },
  {
    value: 'mysql',
    label: 'MySQL',
    peerDep: 'mysql2',
    className: 'MysqlDriver',
    module: `${CORE}/drivers/mysql`,
    connect: `import { PortQueue } from '@portqueue/core';
import { MysqlDriver } from '@portqueue/core/drivers/mysql';

const pq = new PortQueue({
  driver: new MysqlDriver({ connectionString: process.env.MYSQL_URL }),
});
await pq.init();`,
  },
  {
    value: 'oracle',
    label: 'Oracle',
    peerDep: 'oracledb',
    className: 'OracleDriver',
    module: `${CORE}/drivers/oracle`,
    connect: `import { PortQueue } from '@portqueue/core';
import { OracleDriver } from '@portqueue/core/drivers/oracle';

const pq = new PortQueue({
  driver: new OracleDriver({
    connectString: process.env.ORACLE_DSN,
    user: 'app',
    password: process.env.ORACLE_PW,
  }),
});
await pq.init();`,
  },
  {
    value: 'pglite',
    label: 'PGLite',
    peerDep: '@electric-sql/pglite',
    className: 'PgliteDriver',
    module: `${CORE}/drivers/pglite`,
    connect: `import { PortQueue } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';

const pq = new PortQueue({ driver: new PgliteDriver({ dataDir: './pgdata' }) });
await pq.init();`,
  },
  {
    value: 'sqlite',
    label: 'SQLite',
    peerDep: 'better-sqlite3',
    className: 'SqliteDriver',
    module: `${CORE}/drivers/sqlite`,
    connect: `import { PortQueue } from '@portqueue/core';
import { SqliteDriver } from '@portqueue/core/drivers/sqlite';

const pq = new PortQueue({ driver: new SqliteDriver({ path: './queue.db' }) });
await pq.init();`,
  },
];

export interface PackageManagerInfo {
  value: string;
  label: string;
  /** The add/install subcommand for this package manager. */
  add: string;
  default?: boolean;
}

export const PACKAGE_MANAGERS: PackageManagerInfo[] = [
  { value: 'npm', label: 'npm', add: 'npm install', default: true },
  { value: 'pnpm', label: 'pnpm', add: 'pnpm add' },
  { value: 'yarn', label: 'yarn', add: 'yarn add' },
  { value: 'bun', label: 'bun', add: 'bun add' },
];
