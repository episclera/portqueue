# @portqueue/dashboard

A self-hostable React dashboard that plugs into your existing Node HTTP server (raw Node, Express, Koa, Fastify, NestJS) as middleware and rides on a `PortQueue` instance you provide — it never opens its own DB connection.

```bash
npm install @portqueue/dashboard
```

```ts
import express from 'express';
import { createDashboard } from '@portqueue/dashboard';

const dashboard = createDashboard({ portQueue: pq, basePath: '/portqueue' });

const app = express();
// `basePath` is the mount point, so the middleware goes on at the root.
app.use(dashboard.express());
```

Overview, instances, schedules, queue and job pages, with pause/resume, retry, cancel, remove and transactional bulk actions. Every table is paged, searched and filtered in the database.

The dashboard ships **no authentication of its own** — put your existing session/SSO/API-key middleware in front of the mount. See the [dashboard docs](https://episclera.github.io/portqueue/docs/dashboard) for the per-framework recipes.

**MIT** — free for commercial use, no obligations.
