# 13 — CLI (`@portqueue/cli`)

A friendly command-line tool for monitoring and operating PortQueue, and for serving the dashboard. Anything possible programmatically should be possible from the CLI.

## 13.1 Principles

- **User-friendly and colorful** — clear tables, colored state labels, spinners for long ops, `--json` for machine output. Use a tiny zero/low-dep approach (Node's `util.styleText`/ANSI, `node:readline`) rather than heavyweight CLI frameworks where feasible; a small vetted arg parser is acceptable if justified (file 20). No positional soup — subcommands + named flags.
- **Named flags over positions.** Every command uses `--flag value` style; connection details come from flags/env, never guessed.
- **Connects like the library** — the CLI builds a `PortQueue` from connection flags and reuses the exact same core APIs. No separate query logic.

## 13.2 Connection flags (shared by all commands)

- `--driver <postgres|pglite|sqlite|oracle>` (required).
- `--connection <string>` or engine-specific flags (`--host --port --user --password --database`, `--file` for sqlite/pglite). Also read from env (`PORTQUEUE_*`) so secrets aren't in shell history.
- `--schema`, `--table-prefix`, `--namespace` — mirror `PortQueueOptions`.
- `--json` — machine-readable output; `--no-color`; `--log-level`.

The CLI errors early with an actionable message if the matching driver's peer client isn't installed (file 11.6).

## 13.3 Commands

Monitoring / read:
- `portqueue stats [--queue <name>] [--watch]` — state counts, throughput, failure rate; `--watch` refreshes live.
- `portqueue queues` — list queues with counts + paused state.
- `portqueue jobs --queue <name> [--state <state>] [--schedule-id <id>] [--limit --cursor]` — paged job list.
- `portqueue job --id <jobId>` — full job detail (incl. error, steps, instance attribution).
- `portqueue schedules [--queue <name>]` — list recurring definitions + next run.

Actions (mutating; require `--yes` or an interactive confirm):
- `portqueue add --queue <name> --data <json|@file> [--priority --delay --max-attempts --idempotency-key ...]` — enqueue a job (flags map to `JobOptions`).
- `portqueue retry --id <jobId>` / `portqueue cancel --id <jobId>` / `portqueue remove --id <jobId>`.
- `portqueue purge --queue <name> --state <state> [--older-than <duration>]`.
- `portqueue pause --queue <name> [--mode processing|all]` / `portqueue resume --queue <name>`.
- `portqueue schedule create --queue <name> --key <key> (--cron "<expr>" | --every <duration>) [--timezone <IANA>] [--data <json|@file>] [--priority --max-attempts ...] [--start-at --end-at]` — upsert a recurring definition (idempotent on `--queue`+`--key`); exactly one of `--cron`/`--every` required. `portqueue schedule list [--queue]` and `portqueue unschedule --queue <name> --key <key>` for the rest.

Operational:
- `portqueue migrate [--mode auto|validate-only]` — run/verify schema migrations (the `MANUAL` path from file 04).
- `portqueue doctor` — connect, probe capabilities, report schema version vs expected, LISTEN/NOTIFY availability, and any config warnings. A first-stop diagnostic.
- `portqueue listen [--queue <name>] [--events ...]` — **run infinitely**, streaming events as they happen (the raw-plan "run infinitely when listening to events"); colored, one line per event, `--json` for piping.

Dashboard:
- `portqueue dashboard --port <n> [--host] [--base-path] [--root-user <u> --root-password <p>] [--read-only]` — starts a **simple Node server that serves the `@portqueue/dashboard`** bound to a `PortQueue` built from the connection flags. Because a served dashboard is exposed, it **requires auth**: it prompts for (or takes via flags/env) a root username + password and mounts the dashboard behind basic auth (file 12.5). This is listed as the **first** dashboard-hosting option in the docs, ahead of the framework-middleware options.

## 13.4 Docker usage

Docs (file 15) show running the dashboard via the CLI in a container:
- A documented `docker run` invocation passing connection + auth via env, exposing the port. The CLI server is just a thin Node HTTP server serving the dashboard package — no build step needed by the user.
- An example `Dockerfile`/compose snippet for teams that want the dashboard as its own small container pointed at their DB (using a read-scoped connection).

## 13.5 Output & UX details

- Tables use aligned columns; state names are colorized (`ACTIVE` cyan, `COMPLETED` green, `FAILED` red, `RETRY` yellow, `STALLED` magenta).
- Durations/timestamps rendered human-friendly (`2m ago`, `in 30s`) with `--utc`/`--iso` for exact values.
- Non-zero exit codes on failure so the CLI is script-friendly; `--json` output is stable and documented.
- Every command has `--help` with examples.

## 13.6 Local final-check checklist

- [ ] Subcommands + named flags only; connection via flags/env; no positional args.
- [ ] Read, action, operational, listen, and dashboard commands all present; actions confirm or require `--yes`.
- [ ] `listen` runs infinitely streaming events; `--watch` live-refreshes stats.
- [ ] `dashboard` starts a simple Node server behind required basic auth (root user/pass), documented as the first hosting option, with a docker example.
- [ ] Reuses core APIs; clear early error if the driver's peer client is missing.
- [ ] Colorized, human-friendly output with `--json`/`--no-color` and script-friendly exit codes.
