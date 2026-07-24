---
id: cli
title: CLI
sidebar_label: CLI
---

# CLI

`@portqueue/cli` operates a PortQueue from the terminal. It **builds its own short-lived
instance** from the connection flags you pass — it never loads your app's code or a config
file. The CLI runs with monitoring off, no `instanceKey`, and no workers, so it never picks
up jobs or registers as an instance; it just connects, runs one command, and disconnects.

## Connecting

Point the CLI at your database with `--driver` and a connection string. The connection
string comes from `--connection-string` or the `DATABASE_URL` environment variable.

```bash
# explicit driver + connection string
portqueue queues --driver postgres --connection-string postgres://user:pass@host:5432/app

# or rely on DATABASE_URL
DATABASE_URL=postgres://user:pass@host:5432/app portqueue queues --driver postgres
```

When the connection string carries a recognizable URL scheme, `--driver` can be omitted and
the engine is inferred: `postgres://` / `postgresql://` → postgres, `mysql://` → mysql,
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
# Usage: ./pq <command> [flags]   e.g.  ./pq queues   ./pq retry --id abc --yes
set -euo pipefail
exec portqueue \
  --driver postgres \
  --connection-string "${DATABASE_URL:-postgres://user:pass@localhost:5432/app}" \
  "$@"
```

Make it executable once (`chmod +x pq`), then:

```bash
./pq queues
./pq stats --watch
./pq retry --id <jobId> --yes
```

The connection lives in one place, and `"$@"` passes the rest through — so every command is just
`./pq <command> [flags]`. Override the default per-run with `DATABASE_URL=… ./pq queues`.

## Global flags

| Flag | Description |
| --- | --- |
| `--driver <engine>` | `postgres` \| `pglite` \| `sqlite` \| `mysql` \| `oracle` |
| `--connection-string <s>` | DB connection string (also via `DATABASE_URL`) |
| `--schema <name>` | Optional storage schema |
| `--table-prefix <name>` | Optional table prefix (default `pq_`) |
| `--namespace <name>` | Optional pub/sub namespace |
| `--json` | Machine-readable output |
| `--no-color` | Disable ANSI color |

The `--schema`, `--table-prefix`, and `--namespace` flags must match the values your app
configures on its driver, so the CLI reads and writes the same tables and channels. (The
`sqlite` driver has no schema, so `--schema` is ignored there.)

## Common commands

Using the `./pq` wrapper from above so the connection flags stay out of the way:

```bash
# live stats, refreshing
./pq stats --watch

# tail the event feed for one queue (runs until interrupted)
./pq listen --queue orders

# retry a failed job
./pq retry --id <jobId> --yes

# remove a long-inactive instance (refused unless unseen for 30+ min)
./pq remove-instance --instance-key 10.0.9.9:ram-2gb:cpu-1cor

# remove an unused queue (refused if this process still declares it)
./pq remove-queue --queue legacy-emails

# serve the dashboard (see the Dashboard page)
./pq dashboard --port 9000 --root-user admin --root-password ****

# run migrations as a separate deploy step
./pq migrate
```

To run the CLI-hosted dashboard in a container, see
[Dashboard → Docker](./dashboard.mdx#docker).
