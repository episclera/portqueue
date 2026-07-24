# @portqueue/dashboard

A self-hostable React dashboard that plugs into your existing Node HTTP server (raw Node, Express, Koa, Fastify) as middleware and rides on a `PortQueue` instance you provide — it never opens its own DB connection.

```bash
npm install @portqueue/dashboard
```

```ts
import express from 'express';
import { createDashboard } from '@portqueue/dashboard';

const dashboard = createDashboard({
  portQueue: pq,
  basePath: '/portqueue',
  auth: { mode: 'basic', username: 'admin', password: process.env.PQ_PASS! },
  readOnly: false,
});

const app = express();
app.use('/portqueue', dashboard.express());
```

Overview / queue / job / schedules pages, live updates (SSE + 30s reconcile), pause/resume, retry, bulk actions. **MIT** — free for commercial use, no obligations.
