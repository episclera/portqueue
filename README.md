# PortQueue

**A database-backed job queue for Node.js that works across multiple database engines.**

PortQueue treats your relational database as the single source of truth for background jobs — no Redis, no broker. Write your queue code once and run it on **Postgres, PGLite, SQLite, or Oracle** (or plug in a custom driver for any engine).

> **Free and open source. Commercial use permitted. No license fee, no obligations.** (MIT)

## Why PortQueue

- **One API across every driver.** Swap Postgres for SQLite without touching app code.
- **Developer experience first.** Named-options objects, no positional arguments, importable enums instead of magic strings, strict types with no `any`, result objects (never bare ids), and error messages that explain the fix.
- **Horizontally scalable.** Multiple instances cooperate through row-level claiming (`SKIP LOCKED` or a safe fallback) — no double-processing.
- **Fault tolerant.** A throwing handler never crashes the worker loop.
- **Transactional enqueue.** A job is queued if and only if your surrounding DB transaction commits.
- **Feature-complete:** concurrency, rate limiting, priorities, delayed jobs, cron/recurring with timezones, idempotency, multi-step workflows, retention, backpressure, graceful shutdown.
- **Minimal footprint.** Near-zero runtime dependencies; DB clients are optional peers you choose.

## Packages

| Package | Description |
|---|---|
| [`@portqueue/core`](./packages/core) | The queue engine, driver model, and first-party drivers |
| [`@portqueue/dashboard`](./packages/dashboard) | Pluggable React dashboard middleware |
| [`@portqueue/cli`](./packages/cli) | Command-line tool for stats, actions, and serving the dashboard |

## Quick start

```bash
npm install @portqueue/core
# plus the client for your database, e.g.
npm install better-sqlite3   # or: pg, @electric-sql/pglite, oracledb
```

```ts
import { PortQueue } from '@portqueue/core';
import { SqliteDriver } from '@portqueue/core/drivers/sqlite';

const pq = new PortQueue({ driver: new SqliteDriver({ path: './queue.db' }) });
await pq.init();

const emails = pq.createQueue('emails');
pq.createWorker({
  queue: 'emails',
  concurrency: 10,
  handler: async (job) => { await send(job.data); },
});

await emails.addJob({ data: { to: 'a@b.com' } });
```

## Contributing

- Install: `nvm use && npm install` (installs all workspaces).
- Build: `npm run build`. Test: `npm test`. Lint + typecheck: `npm run lint` (ESLint + `tsc --noEmit` in one step).
- Commits follow **Conventional Commits** (enforced by commitlint) — the changelog is derived from them.
- Tests use **PGLite + SQLite only** (no external DB server needed).

See [`build_plan/`](./build_plan) for the full design specification.

## License

MIT — see [LICENSE](./LICENSE). Free and open source, commercial use permitted, no obligations.
