---
slug: introducing-portqueue
title: Introducing PortQueue
authors: [gheorghe]
tags: [announcement]
description: Introducing PortQueue, a broker-less, strictly typed job queue for Node.js that runs on Postgres, Oracle, PGLite, and SQLite from one API.
keywords: [portqueue, job queue, background jobs, database queue, broker-less, node.js, typescript, bullmq alternative]
---

**PortQueue is a database-backed job queue for Node.js** — no broker required. If your
app already runs a relational database, you already have everything you need for a
reliable queue. PortQueue treats that database as the single source of truth and works
across Postgres, Oracle, PGLite, and SQLite from one API.

<!-- truncate -->

## Why another queue?

Most Node queues assume Redis. That's a great fit for some teams and an unwanted extra
moving part for many others — a second datastore to run, secure, back up, and reason
about. Meanwhile, Postgres with `SKIP LOCKED` and `LISTEN/NOTIFY` is more than enough for
a robust queue, as pg-boss showed. PortQueue takes that insight and makes it
**multi-driver**, **strictly typed**, and **transactional**.

## What you get

- **One API across every engine.** Swap the driver import; your app code is unchanged.
- **Producer/consumer split.** `Queue` produces, `Worker` consumes — "produce here,
  process there" is a first-class deployment.
- **Transactional enqueue.** A job exists only if your business transaction commits — the
  dual-write bug, gone.
- **Resumable workflows.** Multi-step jobs where each step is its own crash-safe row —
  not fragile numeric progress.
- **Operational maturity.** Retries with backoff, rate limiting, backpressure, cron with
  timezones, a dashboard, and a CLI — no third-party service.

## A first taste

```ts
import { PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

const pq = new PortQueue({ driver: new PostgresDriver({ connectionString: process.env.DATABASE_URL }) });
await pq.init();

const emailsQueue = pq.createQueue('emails');
await emailsQueue.addJob({ data: { to: 'a@b.com' } });

pq.createWorker({ queue: 'emails', concurrency: 10, handler: async (job) => send(job.data) });
```

Free and open source. Commercial use permitted. No license fee, no obligations.

Head to [Getting Started](/docs/getting-started/installation) to try it.
