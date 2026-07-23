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
  limiter: {
    concurrency: 10,        // max in-flight handlers on this instance (default 1)
    batchSize: 20,          // max jobs claimed per fetch
    pollIntervalMs: 1000,   // poll cadence when LISTEN/NOTIFY is unavailable
    lockDurationMs: 30_000, // visibility timeout / heartbeat window
  },
  handler: async (job) => { await send(job.data); },
});
```

Every throughput and claim knob lives under one `limiter` group: `concurrency`, `rateMax` +
`rateDuration`, `respectSystemPressure`, `batchSize`, `pollIntervalMs`, and `lockDurationMs`.
Omit the group for sensible defaults.

## The Job context

The object passed to a handler is a read-only view of the job row plus a few control
methods:

```ts
pq.createWorker({
  queue: 'emails',
  handler: async (job) => {
    job.id;              // string
    job.queue;           // string
    job.data;            // TData — the payload, typed to the queue
    job.retryAttempt;    // number
    job.metadata;        // opaque JSON (traceId, tenantId, …)
    job.signal;          // AbortSignal — fires on graceful-shutdown timeout
    await job.extendLock({ byMs: 30_000 }); // override the automatic heartbeat
  },
});
```

**Returning** resolves the job (its return value is stored); **throwing** triggers
retry/fail per policy — a throw never crashes the worker loop. Long-running handlers
should observe `job.signal` so they can bail when a graceful shutdown times out (v1 runs
handlers on the main event loop, so a job can't be force-killed).

## Job states

Every job is a row in the `job` table that moves through the `JobStatus` enum:

| Status | Meaning |
|---|---|
| `PENDING` | Waiting to be claimed (may be delayed via `startAfter`). |
| `ACTIVE` | Claimed by an instance and running in a handler. |
| `COMPLETED` | Handler returned successfully; `return_value` stored. |
| `FAILED` | Terminal after retries are exhausted (or a non-retryable error). |
| `RETRY` | Failed but scheduled for another attempt (backoff applied). |
| `STALLED` | Lock expired without completion — reclaimable by another instance. |
| `CANCELLED` | Cancelled before/while running. |
| `EXPIRED` | Not started before its `expireIn` window. |

## Claiming & visibility timeout

Jobs are claimed with row-level locking (`SKIP LOCKED` where the engine supports it) so N
instances never double-process. A claim is invisible to other instances for a **visibility
timeout** (`lockDurationMs`, default ~30s), refreshed by an automatic heartbeat. If a
process dies mid-job the lock lapses, the job becomes `STALLED`, and another instance
reclaims it. This is the *acks-late* model: a job isn't "done" until its handler confirms.

## At-least-once & idempotency

PortQueue guarantees **at-least-once** delivery — a job runs at least once, and under
crash/retry conditions may run more than once (the same trade-off as Celery's *acks-late*
model: never *lose* work, at the cost of possibly *repeating* it).

**The rule:** assume any handler can run twice. Make handlers **idempotent** — a second
run with the same input produces the same result and no duplicate side effects. On the
producer side, `idempotencyKey` prevents inserting a duplicate job and `singletonKey`
keeps at most one active job per key — see
[Producing jobs](./producing-jobs.md#idempotency--singleton).

## Concurrency & parallelism

`limiter.concurrency` sets how many handlers run **in parallel** within one worker. It is
**worker-local** — it caps parallelism on *that one running instance*, not across the fleet.
Because each job is an independently claimed row, there is **no head-of-line blocking** inside a
queue — a slow job never stalls the others. Queues are also independent: a job never
waits on another queue (per-queue claim loops, `queue_name`-scoped claiming). Scale out by
raising `limiter.concurrency` and by running more instances.

## Error handling & retries

Throwing triggers retry/fail per the job's policy; a throw **never** crashes the loop.
The retry *schedule* is a producer/job concern:

```ts
const webhooks = pq.createQueue('webhooks');
await webhooks.addJob({
  data,
  retry: {
    maxAttempts: 5,
    delay: '2s',
    backoff: { strategy: BackoffStrategy.EXPONENTIAL, factor: 2, maxDelay: '5m', jitter: true },
  },
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
pq.createWorker({
  queue: 'third-party',
  limiter: { concurrency: 10, rateMax: 50, rateDuration: '1m' },
});
```

The worker's rate cap (`rateMax` + `rateDuration`, both required together) is worker-local
(in-process) — see [Rate limiting](./rate-limiting.md).
There is no cluster-wide job-rate cap: scale throughput by adding or removing workers/instances.

## Observing

There is no per-worker `on`. Subscribe on the client:

```ts
pq.on(PortQueueEvent.JOB_COMPLETED, ({ jobId, durationMs }) => {}, { queue: 'emails' });
pq.on(PortQueueEvent.JOB_FAILED, ({ jobId, error }) => {}, { queue: 'emails' });
```
