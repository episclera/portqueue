# PortQueue examples

Minimal, self-contained reproduction apps for [`@portqueue/core`](../packages/core) and
[`@portqueue/dashboard`](../packages/dashboard). Every example uses the **PGLite** driver with a
file-backed data directory under the repo-root `tmp/` folder (gitignored, the same convention as
`scripts/cli`), so nothing external needs to be installed or started — no Docker, no database
server.

Each folder is a workspace package, so the examples resolve `@portqueue/*` straight from this repo.

| Example | What it shows |
| --- | --- |
| [`dashboard-node-server`](./dashboard-node-server) | Serve the dashboard from a plain `node:http` server |
| [`dashboard-express`](./dashboard-express) | Mount the dashboard as Express middleware alongside your own routes |
| [`job-scheduling`](./job-scheduling) | Delayed (one-off) and recurring (interval + cron) jobs |

## Running

From the repo root (builds `@portqueue/core` + `@portqueue/dashboard` on first run):

```bash
npm run example:dashboard-node        # http://127.0.0.1:4321/portqueue
npm run example:dashboard-express     # http://127.0.0.1:4322/portqueue
npm run example:schedule-delayed
npm run example:schedule-recurring
```

Or from inside an example folder: `npm start` (dashboards) / `npm run delayed` / `npm run recurring`.
The launcher scripts live in [`scripts/dev/examples`](../scripts/dev/examples).
