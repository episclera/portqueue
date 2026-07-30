# @portqueue/dashboard

A self-hostable React dashboard that plugs into your existing Node HTTP server (raw Node, Express, Koa, Fastify, NestJS) as middleware. Give it a **driver** and it builds its own headless PortQueue behind the scenes — so it can run in the same process as your workers or in one of its own. Nothing connects at mount: the first request opens the connection, and `dashboard.close()` releases it.

```bash
npm install @portqueue/dashboard
```

```ts
import express from 'express';
import { createDashboard } from '@portqueue/dashboard';

const dashboard = createDashboard({ driver, basePath: '/portqueue' });

const app = express();
// `basePath` is the mount point, so the middleware goes on at the root.
app.use(dashboard.express());
```

Overview, instances, schedules, queue and job pages, with pause/resume, retry, cancel, remove and bulk actions — each of which is a single statement. Every table is paged, searched and filtered in the database.

The dashboard ships **no authentication of its own** — put your existing session/SSO/API-key middleware in front of the mount. See the [dashboard docs](https://episclera.github.io/portqueue/docs/dashboard) for the per-framework recipes.

**MIT** — free for commercial use, no obligations.
