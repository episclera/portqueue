# PortQueue

**The distributed, fault-tolerant, database-agnostic, performance-focused queue implementation.**

## Documentation

📚 **[Read the full documentation →](https://episclera.github.io/portqueue/)**

- **Getting started** — [Installation](https://episclera.github.io/portqueue/docs/getting-started/installation) · [Your first queue](https://episclera.github.io/portqueue/docs/getting-started/first-queue)
- **Guides** — [Producing jobs](https://episclera.github.io/portqueue/docs/guides/producing-jobs) · [Consuming jobs](https://episclera.github.io/portqueue/docs/guides/consuming-jobs) · [Transactional enqueue](https://episclera.github.io/portqueue/docs/guides/transactions) · [Scheduling & cron](https://episclera.github.io/portqueue/docs/guides/scheduling)
- **Operate** — [Scaling horizontally](https://episclera.github.io/portqueue/docs/scale-horizontally) · [Dashboard](https://episclera.github.io/portqueue/docs/dashboard) · [CLI](https://episclera.github.io/portqueue/docs/cli)
- **Reference** — [API reference](https://episclera.github.io/portqueue/docs/api-reference)

PortQueue treats your relational database as the single source of truth for background jobs — no Redis, no broker. Write your queue code once and run it on **Postgres, MySQL, Oracle, PGLite, or SQLite** (or plug in a custom driver for any engine).

## Why PortQueue

- **One API across every driver.** Swap Postgres for SQLite without touching app code.
- **Developer experience first.** Named-options objects, no positional arguments, importable enums instead of magic strings, strict types with no `any`, result objects (never bare ids), and error messages that explain the fix.
- **Horizontally scalable.** Multiple instances cooperate through row-level claiming (`SKIP LOCKED` or a safe fallback) — no double-processing.
- **Fault tolerant.** A throwing handler never crashes the worker loop.
- **Transactional enqueue.** A job is queued if and only if your surrounding DB transaction commits.
- **Feature-complete:** concurrency, rate limiting, priorities, delayed jobs, cron/recurring with timezones, idempotency, retention, backpressure, graceful shutdown.
- **Minimal footprint.** Near-zero runtime dependencies; DB clients are optional peers you choose.

## Quick start

```bash
npm install @portqueue/core
# plus the client for your database, e.g.
npm install pg   # or: mysql2, oracledb, @electric-sql/pglite, better-sqlite3
```

```ts
import { PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

const pq = new PortQueue({
  driver: new PostgresDriver({ connectionString: process.env.DATABASE_URL }),
});
await pq.init();

const emailsQueue = pq.createQueue({ name: 'emails' });
pq.createWorker({
  queue: 'emails',
  concurrency: 10,
  handler: async (job) => { await send(job.data); },
});

await emailsQueue.addJob({ data: { to: 'a@b.com' } });
```

## Contributing

For full details — dev setup, conventions, running the examples, and filing issues & PRs — see the
**[Contributing guide](https://episclera.github.io/portqueue/docs/contributing)**.

## License

MIT — see [LICENSE](./LICENSE). Free and open source, commercial use permitted, no obligations.
