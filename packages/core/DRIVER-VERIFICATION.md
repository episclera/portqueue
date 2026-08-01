# Driver verification

PGLite and SQLite run the conformance kit in CI (`npm test`), so the Postgres SQL is exercised by
inheritance and SQLite directly. **MySQL and Oracle cannot be**: their statements are authored in
their own dialects and no in-process engine speaks either, so they are verified by hand against a
real server — and this file records when that last happened.

A change to `mysql/` or `oracle/` is not done until the kit has been run against that engine.

## Last verified

| Engine | Server            | Kit run | Notes                                                     |
| ------ | ----------------- | ------- | --------------------------------------------------------- |
| MySQL  | 8.4 (docker)      | _never_ | Pending: the lock-token, chunking and bitmask changes below |
| Oracle | 23ai free (docker)| _never_ | Pending: same                                             |

Update the row — engine version, date, and anything that needed a fix — in the same commit as the
driver change that prompted the run.

## Running it

`mysql2` and `oracledb` are dev dependencies, so nothing needs installing first. From the repo root:

```bash
npm run db:mysql:up && npm run test:mysql && npm run db:mysql:down
npm run db:oracle:up && npm run test:oracle && npm run db:oracle:down
```

Each script passes the credentials the dev compose file sets. Oracle takes ~1 minute to become
healthy on first boot (a schema *is* a user there, and the image creates `portqueue` for us).

Underneath, `src/conformance/manual.test.ts` reads its connection details from the environment and
**skips** whichever engine has none — so it is safe in the normal test run, and a bespoke server is
just a different set of variables:

| Variable                 | Engine | Example                                              |
| ------------------------ | ------ | ---------------------------------------------------- |
| `PORTQUEUE_MYSQL_URL`    | MySQL  | `mysql://portqueue:portqueue@localhost:3306/portqueue` |
| `PORTQUEUE_ORACLE_USER`  | Oracle | `portqueue`                                          |
| `PORTQUEUE_ORACLE_PASSWORD` | Oracle | `portqueue`                                       |
| `PORTQUEUE_ORACLE_CONNECT`  | Oracle | `localhost:1521/FREEPDB1`                         |

## Schema changes need a clean database

The kit migrates from scratch and `v1` is `IF NOT EXISTS`-guarded, so it will **not** rewrite a table
that already exists with an older shape. Drop the database (or the `pq_*` tables) before running the
kit after a `v1` change — `db:mysql:down`/`db:oracle:down` removes the container's volume.
