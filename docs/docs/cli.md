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

```bash
# live stats, refreshing
portqueue stats --watch --driver postgres --connection-string $DATABASE_URL

# tail the event feed for one queue (runs until interrupted)
portqueue listen --queue orders --driver postgres --connection-string $DATABASE_URL

# retry a failed job
portqueue retry --id <jobId> --yes --driver postgres --connection-string $DATABASE_URL

# remove a long-inactive instance (refused unless unseen for 30+ min)
portqueue remove-instance --instance-key 10.0.9.9:ram-2gb:cpu-1cor \
  --driver postgres --connection-string $DATABASE_URL

# remove an unused queue (refused if this process still declares it)
portqueue remove-queue --queue legacy-emails \
  --driver postgres --connection-string $DATABASE_URL

# serve the dashboard (see the Dashboard page)
portqueue dashboard --driver postgres --connection-string $DATABASE_URL --port 9000 \
  --root-user admin --root-password ****

# run migrations as a separate deploy step
portqueue migrate --driver postgres --connection-string $DATABASE_URL
```

To run the CLI-hosted dashboard in a container, see
[Dashboard → Docker](./dashboard.mdx#docker).
