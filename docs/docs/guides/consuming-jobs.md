---
id: consuming-jobs
title: Consuming jobs
sidebar_label: Consuming jobs
---

# Consuming jobs

A worker is a **registration** — it starts claiming automatically after `pq.init()` and
stops on shutdown. It has no lifecycle methods. All consumer concerns live on
`WorkerOptions`.

```ts
pq.createWorker({
  queue: 'emails',
  concurrency: 10,          // max in-flight handlers (default 1)
  batchSize: 20,            // max jobs claimed per fetch
  pollIntervalMs: 1000,     // poll cadence when LISTEN/NOTIFY is unavailable
  lockDurationMs: 30_000,   // visibility timeout / heartbeat window
  handler: async (job) => { await send(job.data); },
});
```

## Concurrency & parallelism

`concurrency` sets how many handlers run **in parallel** within one worker. Because each
job is an independently claimed row, there is **no head-of-line blocking** inside a
queue — a slow job never stalls the others. Queues are also independent: a job never
waits on another queue (per-queue claim loops, `queue_id`-scoped claiming). Scale out by
raising `concurrency` and by running more instances.

## Error handling & retries

Throwing triggers retry/fail per the job's policy; a throw **never** crashes the loop.
The retry *schedule* is a producer/job concern:

```ts
const webhooks = pq.createQueue('webhooks');
await webhooks.addJob({
  data,
  retryMaxAttempts: 5,
  retryDelay: '2s',
  retryBackoff: { strategy: BackoffStrategy.EXPONENTIAL, factor: 2, maxDelay: '5m', jitter: true },
});
```

Which thrown error *types* are non-retryable is a **consumer** concern
(`dontAutoretryFor` — the error classes live in handler code):

```ts
class ValidationError extends Error {}

pq.createWorker({
  queue: 'webhooks',
  handler,
  dontAutoretryFor: [ValidationError, 'AbortError'], // constructor or error.name
});
```

A matched error skips remaining attempts and goes straight to `FAILED`. There is **no
dead-letter queue** — failed jobs stay in `job` (status `FAILED`) for triage and manual
`retryJob({ jobId })`.

## Rate limiting

A worker-local, in-process limiter (exact for this worker):

```ts
pq.createWorker({ queue: 'third-party', concurrency: 10, limiter: { max: 50, duration: '1m' } });
```

For a **cluster-wide** cap, set `rateLimit` on the queue — see [Rate limiting](./rate-limiting.md).

## Observing

There is no per-worker `on`. Subscribe on the client:

```ts
pq.on(PortQueueEvent.JOB_COMPLETED, ({ jobId, durationMs }) => {}, { queue: 'emails' });
pq.on(PortQueueEvent.JOB_FAILED, ({ jobId, error }) => {}, { queue: 'emails' });
```
