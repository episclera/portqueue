# PortQueue examples

Minimal, self-contained reproduction apps for [`@portqueue/core`](../packages/core) and
[`@portqueue/dashboard`](../packages/dashboard). Most examples use the **PGLite** driver with a
file-backed data directory under the repo-root `tmp/` folder (gitignored, the same convention as
`scripts/cli`), so nothing external needs to be installed or started — no Docker, no database
server. The two Postgres examples are the exception: they connect to a **real Postgres server**
(they need the `pg` peer dependency and a `DATABASE_URL`).

Each folder is a workspace package, so the examples resolve `@portqueue/*` straight from this repo.

| Example | Driver | What it shows |
| --- | --- | --- |
| [`dashboard-node-server`](./dashboard-node-server) | PGLite | Serve the dashboard from a plain `node:http` server |
| [`dashboard-express`](./dashboard-express) | PGLite | Mount the dashboard as Express middleware alongside your own routes |
| [`job-scheduling`](./job-scheduling) | PGLite | Delayed (one-off) and recurring (interval + cron) jobs |
| [`retries-backoff`](./retries-backoff) | PGLite | Retries with fixed/exponential backoff and jitter |
| [`idempotency-singleton`](./idempotency-singleton) | PGLite | `idempotencyKey` and `singletonKey` deduplication |
| [`graceful-shutdown`](./graceful-shutdown) | PGLite | Draining in-flight handlers via `job.signal` on shutdown |
| [`postgres-connection`](./postgres-connection) | Postgres | Connect to a real Postgres server with `DATABASE_URL` |
| [`transactional-enqueue`](./transactional-enqueue) | Postgres | Enqueue a job atomically with your own DB write (`addJob({ tx })`) |

## Running

From the repo root. Every launcher rebuilds `@portqueue/core` + `@portqueue/dashboard` first, so an
example always runs your working tree rather than a stale `dist/`; set `PORTQUEUE_SKIP_BUILD=1` to
skip that when no package source has changed:

```bash
npm run example:dashboard-node        # http://127.0.0.1:4321/portqueue
npm run example:dashboard-express     # http://127.0.0.1:4322/portqueue
npm run example:schedule-delayed
npm run example:schedule-recurring
npm run example:retries
npm run example:idempotency
npm run example:graceful

# Postgres examples — set DATABASE_URL first (the DB must already exist):
DATABASE_URL=postgres://user:pass@localhost:5432/app npm run example:postgres
DATABASE_URL=postgres://user:pass@localhost:5432/app npm run example:transactional
```

Or from inside an example folder: `npm start` (dashboards, retries, idempotency, graceful, and the
Postgres examples) / `npm run delayed` / `npm run recurring` (job-scheduling). The launcher scripts
live in [`scripts/dev/examples`](../scripts/dev/examples).

