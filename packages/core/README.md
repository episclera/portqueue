# @portqueue/core

The engine and first-party drivers for **PortQueue** — a database-backed job queue for Node.js that works across multiple database engines (Postgres, PGLite, SQLite, Oracle) through one API.

```bash
npm install @portqueue/core
# + the client for your DB, e.g. one of:
npm install pg              # Postgres
npm install @electric-sql/pglite   # PGLite (embedded/edge/tests)
npm install better-sqlite3  # SQLite (or use Node's built-in node:sqlite)
npm install oracledb        # Oracle
```

```ts
import { PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

const pq = new PortQueue({ driver: new PostgresDriver({ connectionString: process.env.DATABASE_URL }) });
await pq.init();

const emails = pq.createQueue('emails');
pq.createWorker({ queue: 'emails', concurrency: 10, handler: async (job) => send(job.data) });
await emails.addJob({ data: { to: 'a@b.com' } });
```

**Free and open source. Commercial use permitted. No license fee, no obligations.** (MIT)

- Subpath driver imports: `@portqueue/core/drivers/{postgres,pglite,sqlite,oracle}`
- Transaction adapters: `@portqueue/core/tx` (`fromKnex`, `fromPg`, …)
- Custom-driver conformance kit: `@portqueue/core/conformance`

See the [documentation](https://episclera.github.io/portqueue/) for the full API.
