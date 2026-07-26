---
id: first-queue
title: Your first queue & worker
sidebar_label: First queue & worker
description: Build your first PortQueue queue and worker — typed payloads, enum-named queues, add jobs, and process them with a background worker in Node.js.
keywords: [portqueue, job queue, background jobs, workers, typescript, node.js, task queue, postgres queue]
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

const emailsQueue = pq.createQueue<{ to: string; template: string }>(QueueName.Emails);
// pq.createQueue('typo');  // ❌ compile error — not a QueueName
```

The `TData` generic on `createQueue` is the **payload type** and flows through to the
handler. `TQueues` constrains *names* only; the two are independent.

## Add a job

`addJob` takes **one options object** — `data` is a named key, never a positional
argument — and returns a **result object**, not a bare id.

```ts
const emailsJob = await emailsQueue.addJob({ data: { to: 'a@b.com', template: 'welcome' } });
// emailsJob: { jobId, queue: 'emails', status: JobStatus.PENDING, deduplicated: false, startAfter }
```

:::info Jobs have no name
Unlike BullMQ's `add(name, data)`, PortQueue jobs carry **no per-job name**. Routing is
the queue's role (one worker per queue), so a job's *kind* is just which queue it's on.
Labels and correlation live in `job.data` or `idempotencyKey`. See
[Producing Jobs](../guides/producing-jobs.mdx).
:::

## Register a worker

A **`Worker`** is the *consumer* for one queue. It is a **registration, not a control
surface**: it begins claiming automatically once `pq.init()` has run and the queue isn't
paused, and it stops when the client shuts down. It has **no public methods and no
events of its own**.

```ts
pq.createWorker({
  queue: QueueName.Emails,
  limiter: { concurrency: 10 },
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
const emailsQueue = pq.createQueue(QueueName.Emails);
await emailsQueue.addJob({ data: { to: 'a@b.com', template: 'welcome' } });
// → handled by the worker tier, not this process
```

## Controlling and observing

- **Control processing** — pause/resume handling on the **queue** (persisted, cluster-wide):
  `pq.createQueue(QueueName.Emails).pause()` / `.resume()`. There is no per-worker start/stop.
- **Observe** — subscribe on the **client**:
  `pq.on(PortQueueEvent.JOB_COMPLETED, cb, { queue: QueueName.Emails })`.
- **Shut down** — `pq.shutdown({ graceful: true, timeoutSeconds: 30 })` drains every worker on the instance.

See [Consuming Jobs](../guides/consuming-jobs.md) for concurrency, batching, and error handling.
