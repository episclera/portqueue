---
id: examples
title: Examples
sidebar_label: Examples
description: Runnable PortQueue example apps — serve the dashboard from Node or Express and schedule delayed and recurring jobs, all on PGLite with no external database.
keywords: [portqueue, examples, dashboard, job scheduling, node.js, typescript, background jobs]
---

# Examples

Minimal, self-contained example apps live in the
[`examples/`](https://github.com/episclera/portqueue/tree/main/examples) folder of the repository.
Most examples use the **PGLite** driver with a file-backed data directory under the repo-root
`tmp/` folder, so nothing external needs to be installed or started — no Docker, no database
server. The two Postgres examples connect to a **real Postgres server** instead (they need the `pg`
peer dependency and a `DATABASE_URL`). Each folder is a workspace package that resolves
`@portqueue/*` straight from the repo.

| Example | Driver | What it shows |
| --- | --- | --- |
| [`dashboard-node-server`](https://github.com/episclera/portqueue/tree/main/examples/dashboard-node-server) | PGLite | Serve the [dashboard](./dashboard.mdx) from a plain `node:http` server |
| [`dashboard-express`](https://github.com/episclera/portqueue/tree/main/examples/dashboard-express) | PGLite | Mount the dashboard as Express middleware alongside your own routes |
| [`job-scheduling`](https://github.com/episclera/portqueue/tree/main/examples/job-scheduling) | PGLite | Delayed (one-off) and recurring (interval + cron) jobs — see [Delayed & recurring jobs](./guides/scheduling.md) |
| [`retries-backoff`](https://github.com/episclera/portqueue/tree/main/examples/retries-backoff) | PGLite | Retries with fixed/exponential backoff and jitter — see [Retries & backoff](./guides/consuming-jobs.md) |
| [`idempotency-singleton`](https://github.com/episclera/portqueue/tree/main/examples/idempotency-singleton) | PGLite | `idempotencyKey` and `singletonKey` deduplication — see [Producing jobs](./guides/producing-jobs.mdx) |
| [`graceful-shutdown`](https://github.com/episclera/portqueue/tree/main/examples/graceful-shutdown) | PGLite | Draining in-flight handlers via `job.signal` on shutdown |
| [`postgres-connection`](https://github.com/episclera/portqueue/tree/main/examples/postgres-connection) | Postgres | Connect to a real Postgres server with `DATABASE_URL` |
| [`transactional-enqueue`](https://github.com/episclera/portqueue/tree/main/examples/transactional-enqueue) | Postgres | Enqueue a job atomically with your own DB write — see [Transactions](./guides/transactions.mdx) |

## Running

From the repo root (builds `@portqueue/core` and `@portqueue/dashboard` on first run; the two
dashboard examples rebuild both every time, so the UI they serve always matches the working tree —
set `PORTQUEUE_SKIP_BUILD=1` to skip that). Each
example has a root `npm run example:*` script; if you prefer, there's an equivalent shell script
under [`scripts/dev/examples/`](https://github.com/episclera/portqueue/tree/main/scripts/dev/examples)
that does the same thing (some devs like running the `.sh` versions directly):

```bash
npm run example:dashboard-node        # http://127.0.0.1:4321/portqueue
./scripts/dev/examples/dashboard-node-server.sh

npm run example:dashboard-express     # http://127.0.0.1:4322/portqueue
./scripts/dev/examples/dashboard-express.sh

npm run example:schedule-delayed
./scripts/dev/examples/job-scheduling-delayed.sh

npm run example:schedule-recurring
./scripts/dev/examples/job-scheduling-recurring.sh

npm run example:retries
npm run example:idempotency
npm run example:graceful
```

The two Postgres examples need a reachable database that already exists — set `DATABASE_URL` first:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/app npm run example:postgres
DATABASE_URL=postgres://user:pass@localhost:5432/app npm run example:transactional
```

Or run an example directly from its folder with `npm start` (dashboards, retries, idempotency,
graceful, and the Postgres examples) / `npm run delayed` / `npm run recurring` (job-scheduling).

