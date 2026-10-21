---
id: cli
title: CLI
sidebar_label: CLI
description: Operate PortQueue from the terminal with the CLI — inspect queues and stats, retry jobs, run migrations, and serve the dashboard for PostgreSQL, MySQL, and more.
keywords: [portqueue, cli, command line, job queue, postgresql queue, database queue, monitoring, node.js]
---

# CLI

`@portqueue/cli` operates a PortQueue from the terminal. It **builds its own short-lived
instance** from the connection flags you pass — it never loads your app's code or a config
file. The CLI runs with no `systemLimiter`, no `instanceKey`, and no queue handlers, so it never
picks up jobs or registers as an instance; it just connects, runs one command, and disconnects.

## Connecting

Point the CLI at your database with `--driver` and a connection string. The connection
string comes from `--connection-string` or the `DATABASE_URL` environment variable.

:::info
The CLI connects through the same `@portqueue/core` driver your app uses, so the driver's **peer
dependency must be installed** — `pg` for PostgreSQL, `mysql2` for MySQL, `better-sqlite3` for SQLite,
`@electric-sql/pglite` for PGLite, `oracledb` for Oracle. Missing it raises `MISSING_PEER_DEPENDENCY`.
:::

```bash
# explicit driver + connection string
portqueue queues --driver postgresql --connection-string postgres://user:pass@host:5432/app

# or rely on DATABASE_URL
DATABASE_URL=postgres://user:pass@host:5432/app portqueue queues --driver postgresql
```

When the connection string carries a recognizable URL scheme, `--driver` can be omitted and
the engine is inferred: `postgres://` / `postgresql://` → postgresql, `mysql://` → mysql,
`oracle://` → oracle. **`sqlite` and `pglite` have no URL scheme, so they always need
`--driver`** (their connection string is a file path / data directory rather than a URL).

```bash
# engine inferred from the scheme
portqueue queues --connection-string postgres://user:pass@host:5432/app

# sqlite: the connection string is a file path (":memory:" when omitted)
portqueue queues --driver sqlite --connection-string /var/data/pq.sqlite

# pglite: the connection string is a data directory (in-memory when omitted)
portqueue queues --driver pglite --connection-string /var/data/pq
```

## Reuse the connection with a script

Passing `--driver` and `--connection-string` on every command gets old fast. The easiest fix is
a tiny wrapper script that bakes in the connection once, then forwards whatever flags you give it
straight to `portqueue`. Drop this next to your project and use it for every command:

```bash title="pq"
#!/usr/bin/env bash
# Usage: ./pq <command> [flags]   e.g.  ./pq queues   ./pq retry --id abc
set -euo pipefail
exec portqueue \
  --driver postgresql \
  --connection-string "${DATABASE_URL:-postgres://user:pass@localhost:5432/app}" \
  "$@"
```

Make it executable once (`chmod +x pq`), then:

```bash
./pq queues
./pq stats --watch
./pq retry --id <jobId>
```

The connection lives in one place, and `"$@"` passes the rest through — so every command is just
`./pq <command> [flags]`. Override the default per-run with `DATABASE_URL=… ./pq queues`.

## Global flags

| Flag | Default | Description |
| --- | --- | --- |
| `--driver <engine>` | inferred from the connection-string scheme | `postgresql` \| `pglite` \| `sqlite` \| `mysql` \| `oracle`. Required for `sqlite` and `pglite`, which have no URL scheme |
| `--connection-string <s>` | `DATABASE_URL` | DB connection string |
| `--schema <name>` | driver default (none) | Optional storage schema |
| `--table-prefix <name>` | `pq_` | Optional table prefix |
| `--namespace <name>` | `portqueue` | Optional pub/sub namespace |
| `--json` | off | Machine-readable output |
| `--no-color` | color on for a TTY, off when piped or when `NO_COLOR` is set | Disable ANSI color |

The `--schema`, `--table-prefix`, and `--namespace` flags must match the values your app
configures on its driver, so the CLI reads and writes the same tables and channels. (The
`sqlite` driver has no schema, so `--schema` is ignored there.)

## Commands

Every command below is registered in the CLI. Run `portqueue help` (or `portqueue <command> --help`)
for the generated usage. Global connection flags apply to all of them.

### Monitoring (read-only)

| Command | Usage | What it does |
| --- | --- | --- |
| `stats` | `[--queue <name>] [--watch]` | Job counts by state. `--watch` refreshes live |
| `queues` | | List queues with counts + paused state |
| `jobs` | `--queue <name> [--status <s>] [--schedule-id <id>] [--limit <n> --offset <n>]` | Paged job list |
| `job` | `--id <jobId>` | Full detail for a single job |
| `schedules` | `[--queue <name>]` | List recurring definitions. Without `--queue`, every queue's |
| `instances` | `[--limit <n> --offset <n>]` | List instances with liveness, that process's health at the last heartbeat (CPU / memory) and jobs processed |
| `instance` | `--key <instanceKey>` | One instance: its process's health, liveness and job counts by status |

Wherever `--limit` and `--offset` appear they mean the same thing and carry the same defaults as the
API's [`PageQuery`](./api-reference.mdx#pagequery): `--limit` defaults to `50` and is capped at
`500`, `--offset` defaults to `0`.

`CPU (proc)` is that Node process's CPU as a share of **all the cores available to it** (0–100%);
`Mem (proc)` is used heap over V8's limit, not machine RAM. Either prints amber from 75% and red
from 85%.

### Actions

| Command | Usage | What it does |
| --- | --- | --- |
| `add` | `--queue <name> --data <json\|@file> [--priority <n>] [--start-after <seconds>] [--idempotency-key <k>] [--retry-max-attempts <n>] [--cron "<expr>" --timezone <tz> \| --every <seconds>]` | Enqueue a one-off job or create a recurring schedule. `--data` is inline JSON or `@path/to/file.json`. `--start-after` and `--every` are in **seconds** |
| `retry` | `--id <jobId>` | Requeue a failed/completed job (re-arms its own row) |
| `cancel` | `--id <jobId>` | Cancel a pending or active job |
| `remove` | `(--id <jobId> \| --schedule-id <id>)` | Remove a single job **or** a schedule. An ACTIVE job is skipped — cancel it first |
| `remove-queue` | `--queue <name>` | Remove a queue no longer used by any running code |
| `remove-instance` | `--instance-key <key>` | Remove a long-inactive instance from monitoring (refused unless unseen for 30+ min) |
| `purge` | `--queue <name> --status <status> --yes` | **Destructive** bulk delete of jobs in a state. Requires `--yes` |
| `pause` | `--queue <name> [--mode processing\|all]` | Pause a queue (`processing` stops claiming; `all` also refuses new jobs) |
| `resume` | `--queue <name>` | Resume a paused queue |

> `--yes` exists **only** on `purge` (the one destructive bulk command). `retry`, `cancel`, and
> `remove` act on a single id and take no confirmation flag.

### Operational

| Command | Usage | What it does |
| --- | --- | --- |
| `migrate` | `[--mode auto\|validate-only]` | Apply pending schema migrations |
| `doctor` | `[--json]` | Probe the server and report the engine, its version, verified capabilities, the applied vs shipped schema version, and queue/instance counts |
| `listen` | `[--queue <name>]` | Stream the event feed until interrupted |
| `dashboard` | `--port <n> --root-user <u> --root-password <p> [--host <h>] [--base-path <p>]` | Serve the web dashboard |

### `dashboard` flags

| Flag | Default | Description |
| --- | --- | --- |
| `--port <n>` | `4321` | Port to listen on |
| `--host <h>` | `127.0.0.1` | Interface to bind (use `0.0.0.0` in a container) |
| `--root-user <u>` | `PORTQUEUE_ROOT_USER` env | Basic-auth username (required) |
| `--root-password <p>` | `PORTQUEUE_ROOT_PASSWORD` env | Basic-auth password (required) |
| `--base-path <p>` | `/portqueue` | URL prefix the dashboard is served under |

Credentials are required: pass `--root-user`/`--root-password` or set the matching env vars.

The `@portqueue/dashboard` package itself ships no authentication — when you mount it in your own
app, you put your existing auth middleware in front of it (see
[Protecting the dashboard](./dashboard.mdx#protecting-the-dashboard)). `portqueue dashboard` is the
exception: it opens the port itself, with no host application to guard it, so it brings its own
HTTP Basic auth and refuses to start without credentials. It binds to loopback by default —
if you set `--host 0.0.0.0`, terminate TLS in front of it.

## Common commands

Using the `./pq` wrapper from above so the connection flags stay out of the way:

```bash
# live stats, refreshing
./pq stats --watch

# tail the event feed for one queue (runs until interrupted)
./pq listen --queue orders

# retry a failed job (requeues its own row)
./pq retry --id <jobId>

# remove a long-inactive instance (refused unless unseen for 30+ min)
./pq remove-instance --instance-key 10.0.9.9:ram-2gb:cpu-1cor

# remove an unused queue (refused if this process still declares it)
./pq remove-queue --queue legacy-emails

# serve the dashboard on all interfaces (see the Dashboard page)
./pq dashboard --port 9000 --host 0.0.0.0 --root-user admin --root-password "$DASH_PASSWORD"

# run migrations as a separate deploy step
./pq migrate
```

To run the CLI-hosted dashboard in a container, see
[Dashboard → Docker](./dashboard.mdx#docker).
