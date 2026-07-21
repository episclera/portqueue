# 13 — CLI (`@portqueue/cli`)

A friendly command-line tool for monitoring and operating PortQueue, and for serving the dashboard. Anything possible programmatically should be possible from the CLI.

## 13.1 Principles

- **User-friendly and colorful** — clear tables, colored state labels, spinners for long ops, `--json` for machine output. Use a tiny zero/low-dep approach (Node's `util.styleText`/ANSI, `node:readline`) rather than heavyweight CLI frameworks where feasible; a small vetted arg parser is acceptable if justified (file 20). No positional soup — subcommands + named flags.
- **Named flags over positions.** Every command uses `--flag value` style.
- **Uses *your* `PortQueue` instance.** The CLI loads the exact `PortQueue` your application configures — its driver (including **custom drivers**), options, and in-memory queue defaults — from your own code, and calls the same core APIs on it. It **never** takes a connection string and builds its own instance. This means the CLI sees precisely what your app sees (same defaults, same drivers, same config), and per-job defaults that live only on the instance (file 04.3/05) are available without any DB lookup.

## 13.2 Loading the PortQueue instance

The CLI resolves your instance from a **config module**, the same way tools like Drizzle Kit / TypeORM CLI do:

- `--config <path>` — path to a module that **default-exports** a `PortQueue` **or** an (optionally async) factory `() => PortQueue | Promise<PortQueue>`. If omitted, the CLI auto-discovers `portqueue.config.{ts,js,mjs,cjs}` in the working directory (walking up to the nearest one).
- `--export <name>` — use a named export instead of the default.
- **TypeScript configs** are loaded via the project's own runtime/loader (e.g. run the CLI under `tsx`/`ts-node`, or point `--config` at a prebuilt `.js`). The CLI ships **no** TS compiler (keeps `@portqueue/cli` dep-light, file 01); if a `.ts` config can't be loaded it prints the exact loader command to use.
- Lifecycle: the CLI imports the module, resolves the instance, `init()`s it if needed, runs the command, then `shutdown()`s it cleanly. A one-off command never leaves the process connected.
- Output/behavior flags remain: `--json` (machine-readable), `--no-color`, `--log-level`.

Everything else — driver, connection details, schema, table prefix, namespace — comes from *inside* your config module (from `PortQueueOptions`), never from CLI flags. Secrets therefore stay in your app's own config/env, not in shell history.

Example `portqueue.config.ts`:
```ts
import { PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

export default new PortQueue({
  driver: new PostgresDriver({ connectionString: process.env.DATABASE_URL }),
});
```
```bash
portqueue stats --watch                       # auto-discovers portqueue.config.ts
portqueue --config ./ops/pq.config.js jobs --queue emails
```

The CLI errors early with an actionable message if the config can't be found/loaded, or if the resolved driver's peer client isn't installed (file 11.6).

## 13.3 Commands

Monitoring / read:
- `portqueue stats [--queue <name>] [--watch]` — state counts, throughput, failure rate; `--watch` refreshes live.
- `portqueue queues` — list queues with counts + paused state.
- `portqueue jobs --queue <name> [--status <status>] [--schedule-id <id>] [--limit --cursor]` — paged job list.
- `portqueue job --id <jobId>` — full job detail (incl. error, steps, instance attribution).
- `portqueue schedules [--queue <name>]` — list recurring definitions + next run.

Actions (mutating; require `--yes` or an interactive confirm):
- `portqueue add --queue <name> --data <json|@file> [--priority --delay --retry-max-attempts --idempotency-key ...]` — enqueue a job (flags map to `JobOptions`). Passing scheduling flags instead creates/updates a **recurring** definition (same `add`, mirroring the API's `schedule` option): `--schedule-key <key> (--cron "<expr>" | --every <duration>) [--timezone <IANA>] [--start-at --end-at]` — idempotent on `--queue`+`--schedule-key`; exactly one of `--cron`/`--every`.
- `portqueue retry --id <jobId> [--from failed|start]` — requeue a failed/completed job; `--from failed` (default) resumes at the failed step, `--from start` re-runs the whole job (maps to `RetryMode`; file 06.8.1). `portqueue cancel --id <jobId>`.
- `portqueue remove (--id <jobId> | --schedule-id <id>)` — remove **exactly one**: a job (`--id`) or a schedule / "unschedule" (`--schedule-id`). Mutually exclusive; supplying both or neither is a usage error.
- `portqueue purge --queue <name> --status <status> [--older-than <duration>]`.
- `portqueue pause --queue <name> [--mode processing|all]` / `portqueue resume --queue <name>`.
- `portqueue schedule list [--queue]` — list recurring definitions (read-only; maps to `getSchedules`). There is no separate `schedule create`/`unschedule` — create via `add` with schedule flags, remove via `remove --schedule-id`.

Operational:
- `portqueue migrate [--mode auto|validate-only]` — run/verify schema migrations (the `MANUAL` path from file 04).
- `portqueue doctor` — connect, probe capabilities, report schema version vs expected, LISTEN/NOTIFY availability, and any config warnings. A first-stop diagnostic.
- `portqueue listen [--queue <name>] [--events ...]` — **run infinitely**, streaming events as they happen (the raw-plan "run infinitely when listening to events"); colored, one line per event, `--json` for piping.

Dashboard:
- `portqueue dashboard --port <n> [--host] [--base-path] [--root-user <u> --root-password <p>] [--read-only]` — starts a **simple Node server that serves the `@portqueue/dashboard`** bound to the `PortQueue` **loaded from your config module** (13.2). Because a served dashboard is exposed, it **requires auth**: it prompts for (or takes via flags/env) a root username + password and mounts the dashboard behind basic auth (file 12.5). This is listed as the **first** dashboard-hosting option in the docs, ahead of the framework-middleware options.

## 13.4 Docker usage

Docs (file 15) show running the dashboard via the CLI in a container:
- The image includes the user's **config module** (e.g. a small `portqueue.config.js` that constructs the `PortQueue` — with a read-scoped connection if desired). A documented `docker run` passes the DB URL/secrets via env that the *config module* reads, exposes the port, and runs `portqueue dashboard`. The CLI loads the instance from that module rather than taking a connection string itself.
- An example `Dockerfile`/compose snippet for teams that want the dashboard as its own small container: copy in the config module (+ any custom driver code), install the needed DB client, run the CLI. The server is just a thin Node HTTP server serving the dashboard package — no app build step beyond providing the config module.

## 13.5 Output & UX details

- Tables use aligned columns; state names are colorized (`ACTIVE` cyan, `COMPLETED` green, `FAILED` red, `RETRY` yellow, `STALLED` magenta).
- Durations/timestamps rendered human-friendly (`2m ago`, `in 30s`) with `--utc`/`--iso` for exact values.
- Non-zero exit codes on failure so the CLI is script-friendly; `--json` output is stable and documented.
- Every command has `--help` with examples.

## 13.6 Local final-check checklist

- [ ] Subcommands + named flags only; **the instance is loaded from the user's config module** (`--config`/auto-discovery), never built from a connection string.
- [ ] Read, action, operational, listen, and dashboard commands all present; actions confirm or require `--yes`.
- [ ] `listen` runs infinitely streaming events; `--watch` live-refreshes stats.
- [ ] `dashboard` starts a simple Node server behind required basic auth (root user/pass), documented as the first hosting option, with a docker example that ships the config module.
- [ ] Reuses core APIs on the loaded instance (custom drivers included); clear early error if the config can't load or the driver's peer client is missing.
- [ ] Colorized, human-friendly output with `--json`/`--no-color` and script-friendly exit codes.
