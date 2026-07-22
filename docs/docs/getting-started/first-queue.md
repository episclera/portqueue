---
id: first-queue
title: Your first queue
sidebar_label: First queue
---

# Your first queue

A **`Queue`** is the *producer* handle for one named queue: you add, schedule, and
inspect jobs through it. Getting a queue does no I/O beyond lazily ensuring the queue
row exists.

## Name your queues with an enum

`PortQueue` takes an optional `TQueues` generic — a string enum (or literal union) of
the queue names your app uses — and threads it through every queue-name argument, so a
typo is a **compile-time error**.

```ts
import { PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

enum QueueName { Emails = 'emails', Payments = 'payments' }

const pq = new PortQueue<QueueName>({
  driver: new PostgresDriver({ connectionString: process.env.DATABASE_URL }),
});
await pq.init();

const emails = pq.createQueue<{ to: string; template: string }>(QueueName.Emails);
// pq.createQueue('typo');  // ❌ compile error — not a QueueName
```

The `TData` generic on `createQueue` is the **payload type** and flows through to the
handler. `TQueues` constrains *names* only; the two are independent.

## Add a job

`addJob` takes **one options object** — `data` is a named key, never a positional
argument — and returns a **result object**, not a bare id.

```ts
const res = await emails.addJob({ data: { to: 'a@b.com', template: 'welcome' } });
// res: { jobId, queue: 'emails', status: JobStatus.PENDING, deduplicated: false, startAfter }
```

:::info Jobs have no name
Unlike BullMQ's `add(name, data)`, PortQueue jobs carry **no per-job name**. Routing is
the queue's role (one worker per queue), so a job's *kind* is just which queue it's on.
Labels and correlation live in `metadata` or `idempotencyKey`. See
[Producing Jobs](../guides/producing-jobs.md).
:::

Now register a [worker](./first-worker.md) to process it.
