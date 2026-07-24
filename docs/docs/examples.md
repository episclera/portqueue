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
Every example uses the **PGLite** driver with a file-backed data directory under the repo-root
`tmp/` folder, so nothing external needs to be installed or started — no Docker, no database
server. Each folder is a workspace package that resolves `@portqueue/*` straight from the repo.

| Example | What it shows |
| --- | --- |
| [`dashboard-node-server`](https://github.com/episclera/portqueue/tree/main/examples/dashboard-node-server) | Serve the [dashboard](./dashboard.mdx) from a plain `node:http` server |
| [`dashboard-express`](https://github.com/episclera/portqueue/tree/main/examples/dashboard-express) | Mount the dashboard as Express middleware alongside your own routes |
| [`job-scheduling`](https://github.com/episclera/portqueue/tree/main/examples/job-scheduling) | Delayed (one-off) and recurring (interval + cron) jobs — see [Delayed & recurring jobs](./guides/scheduling.md) |

## Running

From the repo root (builds `@portqueue/core` and `@portqueue/dashboard` on first run). Each
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
```

Or run an example directly from its folder with `npm start` (dashboards) / `npm run delayed` /
`npm run recurring`.
