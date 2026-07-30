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
- **SQLite** — `better-sqlite3`, a single small dependency, extremely fast to spin up.

Both can run **in memory**, so there's nothing to install, no container to boot, and
nothing to clean up on disk.

```ts
import { PortQueue } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';

const pq = new PortQueue({ driver: new PgliteDriver() }); // in-memory by default
await pq.init(); // runs migrations against the fresh database
```

:::info Install the driver's peer dependency
Each database driver relies on a peer package you install yourself — `@electric-sql/pglite`
for PGLite, `better-sqlite3` for SQLite, `pg` for Postgres, `mysql2` for MySQL. If it's
missing, the driver throws `MissingPeerDependencyError` (code `MISSING_PEER_DEPENDENCY`) as
soon as it tries to connect. Add the matching package to your dev dependencies before
running the suite.
:::

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
  pq.createQueue<{ to: string }>({ name: 'emails' });
  const seen: string[] = [];
  pq.createWorker<{ to: string }>({
    queue: 'emails',
    handler: async (job) => {
      seen.push(job.data.to);
    },
  });
  const { id } = await pq.addJob({ queue: 'emails', data: { to: 'a@b.com' } });
  await waitForStatus(queue, id, JobStatus.COMPLETED);
  expect(seen).toEqual(['a@b.com']);
});
```

Because each test owns its own database, tests are fully isolated and safe to run in
parallel.

## Wait for a job to finish

Jobs run asynchronously, so a test can't assert the moment after `addJob` resolves — the
handler hasn't run yet. Instead of guessing with a fixed `setTimeout`, **poll the job's
status** until it reaches a terminal state (`COMPLETED` or `FAILED`), with a small delay
and an overall timeout. This is the pattern new tests most often need:

```ts
import { JobStatus } from '@portqueue/core';

async function waitForStatus(queue, jobId, status, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await pq.getJob({ jobId });
    if (job?.status === status) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${jobId} did not reach ${status} in ${timeoutMs}ms`);
}
```

Use `pq.getJob({ jobId })` (or `pq.getJob({ jobId })`) as the source of truth — it reads
the real row through the driver, exactly as production code would. Poll for `JobStatus.FAILED`
when you're testing the failure path.

## Nothing to mock

Everything you'd otherwise be tempted to fake is real here:

- **The database** is real — real transactions, real constraints, real claim/lock behaviour.
- **Producing and consuming** run through the same services as production.
- **Timing** stays deterministic: rather than sleeping, poll the job's status (see
  [Wait for a job to finish](#wait-for-a-job-to-finish)) so time-dependent tests never race.

The result: your tests describe how your app uses the queue, not how the queue is wired
internally — and they stay valid even as PortQueue's internals evolve.
