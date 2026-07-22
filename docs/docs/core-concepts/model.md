---
id: model
title: Client, Queue & Worker
sidebar_label: The model
---

# Client, Queue & Worker

PortQueue has exactly three objects, cleanly separated so "produce here, process there"
is a first-class deployment shape.

- **`PortQueue`** — the client. One per database. Owns the connection, migrations, and
  shared services. Produces `Queue` and `Worker` handles. Construction is DI-only (no
  I/O); `init()` connects and migrates.
- **`Queue`** — the **producer** handle for one named queue: add / schedule / inspect /
  control jobs. Bound to a single queue name.
- **`Worker`** — the **consumer** for one queue: claims jobs and runs handlers. Created
  separately so producing and consuming can live on different servers.

```ts
enum QueueName { Emails = 'emails' }

const pq = new PortQueue<QueueName>({ driver: new PostgresDriver({ /* ... */ }) });
await pq.init();

// 1) queue handle (producer)
const emails = pq.createQueue(QueueName.Emails);
// 2) worker (consumer) — registering it is enough; it starts claiming automatically
pq.createWorker({ queue: QueueName.Emails, concurrency: 10, handler: async (job) => { /* ... */ } });
// 3) add a job
await emails.addJob({ data: { to: 'a@b.com' } });
```

## Why a separate Queue and Worker?

It makes "produce on API servers, consume on worker servers" obvious — you simply don't
call `createWorker` on the API tier. It mirrors BullMQ's proven split, but every option
is a named object and the payload type flows through generics.

## Simple queue vs workflow queue

The **only** difference is the consumer: a simple queue's worker has one `handler`; a
[workflow](../workflows/what-is-a-workflow.md) queue's worker has many `steps`.
Producing is the same `addJob({ data })` in both cases.
