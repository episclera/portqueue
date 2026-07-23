---
id: first-queue
title: Your first queue & worker
sidebar_label: First queue & worker
---

# Your first queue & worker

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

## Register a worker

A **`Worker`** is the *consumer* for one queue. It is a **registration, not a control
surface**: it begins claiming automatically once `pq.init()` has run and the queue isn't
paused, and it stops when the client shuts down. It has **no public methods and no
events of its own**.

```ts
pq.createWorker({
  queue: QueueName.Emails,
  concurrency: 10,
  handler: async (job) => {
    await sendEmail(job.data); // job.data is typed to the queue's payload
  },
});
```

The handler receives a [`Job`](../guides/consuming-jobs.md#the-job-context) context. **Returning**
resolves the job (its return value is stored); **throwing** triggers retry/fail per
policy — a throw never crashes the worker loop.

## Produce here, process there

You do **not** need a worker to add jobs. An API tier can create the queue handle and
call `addJob` only; the jobs it enqueues are picked up by whatever *other* instances
defined a worker for that queue. Because every instance is built from the same config,
the two tiers agree on the queue with no extra coordination.

```ts
// api-server.ts — producer only, no worker here
const emails = pq.createQueue(QueueName.Emails);
await emails.addJob({ data: { to: 'a@b.com', template: 'welcome' } });
// → handled by the worker tier, not this process
```

## Controlling and observing

- **Control processing** — pause/resume handling on the **queue** (persisted, cluster-wide):
  `pq.createQueue(QueueName.Emails).pause()` / `.resume()`. There is no per-worker start/stop.
- **Observe** — subscribe on the **client**:
  `pq.on(PortQueueEvent.JOB_COMPLETED, cb, { queue: QueueName.Emails })`.
- **Shut down** — `pq.shutdown({ graceful: true, timeoutMs: 30_000 })` drains every worker on the instance.

See [Consuming Jobs](../guides/consuming-jobs.md) for concurrency, batching, and error handling.
