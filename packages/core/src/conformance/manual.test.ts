/**
 * The conformance kit against **MySQL and Oracle**, which CI cannot run.
 *
 * Their SQL is authored in their own dialects and no in-process engine speaks either, so this suite
 * takes its connection details from the environment and **skips** an engine that has none. That is
 * what makes it safe to leave in the normal test run: with no variables set it reports nothing and
 * costs nothing, and a developer with a server running gets the full kit against it.
 *
 * See `packages/core/DRIVER-VERIFICATION.md` for the variables, the compose commands, and the record
 * of when each engine was last verified.
 */
import { runConformance } from './index';
import { MysqlDriver } from '../drivers/mysql/index';
import { OracleDriver } from '../drivers/oracle/index';

const mysqlUrl = process.env.PORTQUEUE_MYSQL_URL;
const oracle = {
  user: process.env.PORTQUEUE_ORACLE_USER,
  password: process.env.PORTQUEUE_ORACLE_PASSWORD,
  connectString: process.env.PORTQUEUE_ORACLE_CONNECT,
};

if (mysqlUrl) {
  runConformance({
    name: 'mysql (live server)',
    createDriver: () => new MysqlDriver({ connectionString: mysqlUrl }),
  });
} else {
  // A named, skipped test rather than silence: a run that verified nothing should say so.
  it.skip('mysql conformance (set PORTQUEUE_MYSQL_URL to run it)', () => {});
}

if (oracle.user && oracle.password && oracle.connectString) {
  runConformance({
    name: 'oracle (live server)',
    createDriver: () =>
      new OracleDriver({
        user: oracle.user!,
        password: oracle.password!,
        connectString: oracle.connectString!,
      }),
  });
} else {
  it.skip('oracle conformance (set PORTQUEUE_ORACLE_* to run it)', () => {});
}
