# Driver verification

PGLite and SQLite run the conformance kit in CI (`npm test`), so the PostgreSQL SQL is exercised by
inheritance and SQLite directly. **MySQL and Oracle cannot be**: their statements are authored in
their own dialects and no in-process engine speaks either, so they are verified by hand against a
real server — and this file records when that last happened.

A change to `mysql/` or `oracle/` is not done until the kit has been run against that engine.

## Last verified

| Engine | Server            | Kit run | Notes                                                     |
| ------ | ----------------- | ------- | --------------------------------------------------------- |
| MySQL  | 8 (`mysql:8`, docker)              | _never_ | Pending — see the list below |
| Oracle | 23ai free (`gvenzl/oracle-free:23-slim`, docker) | _never_ | Pending — see the list below |

Update the row — engine version, date, and anything that needed a fix — in the same commit as the
driver change that prompted the run.

### Unverified changes (both engines)

Neither engine has had a run yet, so these are the driver changes the first run will be confirming
— each has a conformance case. Once the kit passes against an engine, record it in the table above
and clear the list (or note which entries still apply to the other engine).

- The claim fence (`lock_token` on every claim, settles guarded on it).
- `chunkIds`/`overIdChunks` on every by-id batch, and the `retention_statuses` bitmask (`&` on
  MySQL, `BITAND` on Oracle).
- The batch driver methods `findJobRefs`, `setQueuesPaused`, `getInstancesByKeys`,
  `setInstancesPaused` and `deleteInstances` (with its `seenBefore` guard), and the singular
  `setQueuePaused`/`setInstancePaused`/`deleteInstance` now delegating to them.
- `insertJobs`' dedup lookups (and the per-queue `FOR UPDATE` lock) chunked by `overIdChunks`, so a
  keyed batch of more than 1000 jobs no longer raises ORA-01795 on Oracle.
- MySQL only: the migration `GET_LOCK` name is scoped by `DATABASE()` when no `schema` is set, and
  hashed rather than truncated past 64 characters.

## Running it

`mysql2` and `oracledb` are dev dependencies, so nothing needs installing first. From the repo root:

```bash
npm run db:mysql:up && npm run test:mysql && npm run db:mysql:down
npm run db:oracle:up && npm run test:oracle && npm run db:oracle:down
```

Each script passes the credentials the dev compose file sets. Wait for the container to report
healthy (`docker ps`) before running the kit — the `up` scripts return as soon as it has started. Oracle takes ~1 minute to become
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
kit after a `v1` change. `db:mysql:down`/`db:oracle:down` only *stop* the container — the data volume
is preserved — so remove it explicitly:

```bash
docker compose -f .docker/docker-compose.yml rm -sf mysql && docker volume rm portqueue-dev_mysql-data
docker compose -f .docker/docker-compose.yml rm -sf oracle && docker volume rm portqueue-dev_oracle-data
```
