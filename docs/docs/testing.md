---
id: testing
title: Testing
sidebar_label: Testing
description: Test PortQueue against a real database with PGLite or SQLite running fully in memory — a clean, isolated database per test, with no need to mock any internal method.
keywords: [portqueue, testing, pglite, sqlite, in-memory database, unit tests, integration tests, node.js, typescript]
---

# Testing

You don't need to mock PortQueue. Because the whole engine sits behind the `Driver`
seam, you can point it at a **real** database that runs entirely in memory — so your
tests exercise the exact same code paths, SQL, and transactions that run in production.
No stubbed queues, no faked internal methods, no "trust me, it works in prod."

## Use a real in-memory database

Two drivers are purpose-built for this:

- **PGLite** — a full Postgres compiled to WASM. If you run Postgres in production, this
  mirrors it faithfully (same dialect, same `INSERT … ON CONFLICT`, real constraints).
- **SQLite** — Node's built-in `node:sqlite`, zero dependencies, extremely fast to spin up.

Both can run **in memory**, so there's nothing to install, no container to boot, and
nothing to clean up on disk.

```ts
import { PortQueue } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';

const pq = new PortQueue({ driver: new PgliteDriver() }); // in-memory by default
await pq.init(); // runs migrations against the fresh database
```

## A clean database for every test

Spin up a brand-new instance per test (or per suite) and you get a pristine schema every
time — no shared state leaking between tests, no ordering dependencies.

```ts
import { PortQueue } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';

let pq: PortQueue;

beforeEach(async () => {
  pq = new PortQueue({ driver: new PgliteDriver() }); // fresh, empty, in-memory
  await pq.init();
});

afterEach(async () => {
  await pq.shutdown();
});

it('processes a job', async () => {
  const queue = pq.createQueue<{ to: string }>('emails');
  const seen: string[] = [];
  pq.createWorker<{ to: string }>({
    queue: 'emails',
    handler: async (job) => {
      seen.push(job.data.to);
    },
  });
  await queue.addJob({ data: { to: 'a@b.com' } });
  // ...assert on `seen` once the job has run
});
```

Because each test owns its own database, tests are fully isolated and safe to run in
parallel.

## Nothing to mock

Everything you'd otherwise be tempted to fake is real here:

- **The database** is real — real transactions, real constraints, real claim/lock behaviour.
- **Producing and consuming** run through the same services as production.
- **Time** is injectable. Pass a `clock` to the `PortQueue` constructor to control "now"
  for delayed jobs, retries with backoff, and cron — so time-dependent tests never need
  to actually wait.

The result: your tests describe how your app uses the queue, not how the queue is wired
internally — and they stay valid even as PortQueue's internals evolve.
