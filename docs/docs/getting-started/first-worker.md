---
id: first-worker
title: Your first worker
sidebar_label: First worker
---

# Your first worker

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
