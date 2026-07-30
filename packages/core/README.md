# @portqueue/core

The engine and first-party drivers for **PortQueue** — a horizontally scalable, fault-tolerant, database-agnostic, performance-focused queue implementation, running on your own database (Postgres, MySQL, Oracle, PGLite, SQLite) through one API.

```bash
npm install @portqueue/core
# + the client for your DB, e.g. one of:
npm install pg              # Postgres
npm install mysql2          # MySQL
npm install oracledb        # Oracle
npm install @electric-sql/pglite   # PGLite (embedded/edge/tests)
npm install better-sqlite3  # SQLite
```

```ts
import { PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

const pq = new PortQueue({ driver: new PostgresDriver({ connectionString: process.env.DATABASE_URL }) });
await pq.init();

// One call per queue: its name, its tuning, and — if this process processes it — its handler.
pq.createQueue({ name: 'emails', limiter: { concurrency: 10 }, handler: (job) => send(job.data) });

// Every operation is a method on `pq`, with the queue named in it.
await pq.addJob({ queue: 'emails', data: { to: 'a@b.com' } });
```

**Free and open source. Commercial use permitted. No license fee, no obligations.** (MIT)

- Subpath driver imports: `@portqueue/core/drivers/{postgres,mysql,oracle,pglite,sqlite}`
- Transaction adapters: `@portqueue/core/tx` (`fromKnex`, `fromPg`, …)
- Custom-driver conformance kit: `@portqueue/core/conformance`

See the [documentation](https://episclera.github.io/portqueue/) for the full API.
