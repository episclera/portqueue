---
id: consuming-jobs
title: Consuming jobs
sidebar_label: Consuming jobs
description: Process jobs by giving a queue a handler — concurrency, batching, at-least-once delivery, idempotency, retries, and cooperative cancellation in Node.js.
keywords: [portqueue, job queue, handler, concurrency, retries, idempotency, background jobs, typescript]
---

# Consuming jobs

**A queue consumes its own jobs.** Give `createQueue` a `handler` and this process processes that
queue: it starts claiming as soon as `pq.init()` has run and the queue isn't paused, and stops on
shutdown. There is nothing to start, stop or hold on to.

```ts
pq.createQueue({
  name: 'emails',
  limiter: {
    concurrency: 10,        // max in-flight handlers in this process (default 1)
    batchSize: 20,          // max jobs claimed per fetch
    pollIntervalSeconds: 1,     // poll cadence when LISTEN/NOTIFY is unavailable, in seconds
    lockDurationSeconds: 30,    // visibility timeout / heartbeat window, in seconds
  },
  handler: async (job) => { await send(job.data); },
});
```

Everything about the queue is in that one call — the handler, the claim tuning, and its
`defaultJobOptions`, `retention` and `hooks`. A process that should only *enqueue* onto this queue
declares nothing at all: `pq.addJob({ queue: 'emails', data })` works from the name alone.

Every throughput and claim knob lives under one `limiter` group: `concurrency`, `rateMax` +
`rateDurationSeconds`, `batchSize`, `pollIntervalSeconds`, and `lockDurationSeconds` — every one of
those durations in seconds. Omit the group for sensible defaults.

Pausing under system pressure isn't set here: define
[`systemLimiter`](./rate-limiting.md#system-pressure-backpressure) on the PortQueue and every queue
this process consumes respects it.

:::info One handler per queue per process
A queue is declared **once per process**: a second `createQueue` for the same name throws. Two claim
loops over one queue would only compete for the same rows — to process more at once raise
`limiter.concurrency`, and to add capacity run another instance.
:::

### `batchSize` vs `concurrency`

These two are easy to confuse — they control different stages of the pipeline:

- **`concurrency`** (default `1`) caps how many handlers may be **running at once** in this
  process. It's the ceiling on *in-flight execution*.
- **`batchSize`** (defaults to `concurrency`) caps how many job rows are **claimed and locked from
  the database in a single fetch**. It's the ceiling on rows locked per claim round-trip.

So `batchSize` shapes the *claim* round-trip and `concurrency` shapes *execution*. A larger
`batchSize` reduces DB round-trips (one fetch grabs more rows) at the cost of locking more rows at
once — but the queue still never runs more than `concurrency` handlers simultaneously; the extra
claimed rows simply wait their turn. Set `batchSize` above `concurrency` to amortize claim latency
when jobs are quick and DB round-trips dominate; keep them equal (the default) otherwise.

## The Job context

The object passed to a handler is a read-only view of the job row plus a few control
methods:

```ts
pq.createQueue({
  name: 'emails',
  handler: async (job) => {
    job.id;              // string
    job.queue;           // string
    job.data;            // TData — the payload, typed to the queue
    job.retryAttempt;    // number
    job.signal;          // AbortSignal — fires on graceful-shutdown timeout
    await job.extendLock({ bySeconds: 30 }); // override the automatic heartbeat (seconds)
  },
});
```

**Returning** resolves the job (its return value is stored); **throwing** triggers
retry/fail per policy — a throw never crashes the claim loop. Long-running handlers
should observe `job.signal` so they can bail when a graceful shutdown times out (v1 runs
handlers on the main event loop, so a job can't be force-killed).

## Job states

Every job is a row in the `job` table that moves through the `JobStatus` enum:

| Status | Meaning |
|---|---|
| `PENDING` | Waiting to be claimed (may be delayed via `schedule.startAfterSeconds`). |
| `ACTIVE` | Claimed by an instance and running in a handler. |
| `COMPLETED` | Handler returned successfully; `return_value` stored. |
| `FAILED` | Terminal after retries are exhausted (or a non-retryable error). |
| `RETRY` | Failed but scheduled for another attempt (backoff applied). |
| `CANCELLED` | Cancelled before/while running. |
| `EXPIRED` | Not started before its `expireInSeconds` window. |

There is deliberately no `STALLED` status. A job whose lock lapsed is still `ACTIVE` — being
stalled is *derived* from the lock deadline, and `JobSnapshot.stalled` is the one place it is
computed. So you filter on `ACTIVE` and read `stalled` on the row, rather than branching on a
status the database never holds.

## Claiming & visibility timeout

Jobs are claimed with row-level locking (`SKIP LOCKED` where the engine supports it) so N
instances never double-process. A claim is invisible to other instances for a **visibility
timeout** (`lockDurationSeconds`, default 30), refreshed by an automatic heartbeat. If a
process dies mid-job the lock lapses, the row reads as `stalled`, and another instance
reclaims it. This is the *acks-late* model: a job isn't "done" until its handler confirms.

### Extending the lock

While your handler runs, PortQueue **automatically renews** the lock in the background — a
heartbeat refreshes the `lockDurationSeconds` window (default 30) for as long as the handler is
executing. So under normal conditions you **never call `extendLock` yourself**; a handler that
simply takes a long time keeps its lock without any effort.

Manual `job.extendLock({ bySeconds })` is only needed for a **single long, uninterruptible unit of
work** that could outlast the window because the automatic heartbeat can't fire in time — e.g. a
blocking synchronous call that starves the event loop, so the heartbeat timer is delayed past
`lockDurationSeconds` and the job risks being reclaimed elsewhere as stalled. If your work
is normal async code that yields to the event loop, the heartbeat handles it and `extendLock` is
unnecessary.

## At-least-once & idempotency

PortQueue guarantees **at-least-once** delivery — a job runs at least once, and under
crash/retry conditions may run more than once (the same trade-off as Celery's *acks-late*
model: never *lose* work, at the cost of possibly *repeating* it).

**The rule:** assume any handler can run twice. Make handlers **idempotent** — a second
run with the same input produces the same result and no duplicate side effects. On the
producer side, `idempotencyKey` prevents inserting a duplicate job and `singletonKey`
keeps at most one active job per key — see
[Producing jobs](./producing-jobs.mdx#idempotency--singleton).

## Concurrency & parallelism

`limiter.concurrency` sets how many handlers run **in parallel** for one queue in one process. It is
**process-local** — it caps parallelism on *that one running instance*, not across the fleet.
Because each job is an independently claimed row, there is **no head-of-line blocking** inside a
queue — a slow job never stalls the others. Queues are also independent: a job never
waits on another queue (per-queue claim loops, `queue_name`-scoped claiming). Scale out by
raising `limiter.concurrency` and by running more instances.

## Error handling & retries

Throwing triggers retry/fail per the job's policy; a throw **never** crashes the loop.
The retry *schedule* is a producer/job concern:

```ts
await pq.addJob({
  queue: 'webhooks',
  data,
  retry: {
    maxAttempts: 5,
    delaySeconds: 2,   // base delay before a retry, in seconds
    backoff: { strategy: BackoffStrategy.EXPONENTIAL, factor: 2, maxDelaySeconds: 300, jitter: true },
  },
});
```

Which thrown error *types* are non-retryable is a **consumer** concern
(`dontAutoretryFor` — the error classes live in handler code), so it sits beside the handler:

```ts
class ValidationError extends Error {}

pq.createQueue({
  name: 'webhooks',
  handler,
  dontAutoretryFor: [ValidationError, 'AbortError'], // constructor or error.name
});
```

A matched error skips remaining attempts and goes straight to `FAILED`. There is **no
dead-letter queue** — failed jobs stay in `job` (status `FAILED`) for triage and manual
`retryJob({ jobId })`.

## Rate limiting

A process-local, in-memory limiter (exact for this queue in this process):

```ts
pq.createQueue({
  name: 'third-party',
  limiter: { concurrency: 10, rateMax: 50, rateDurationSeconds: 60 }, // 50 per 60-second window
  handler,
});
```

The rate cap (`rateMax` + `rateDurationSeconds`, both required together) is process-local — see
[Rate limiting](./rate-limiting.md).
There is no cluster-wide job-rate cap: scale throughput by adding or removing instances.

## Observing

There is nothing per-queue to subscribe to. Subscribe on the client:

```ts
pq.on(PortQueueEvent.JOB_COMPLETED, ({ jobId, durationSeconds }) => {}, { queue: 'emails' });
pq.on(PortQueueEvent.JOB_FAILED, ({ jobId, error }) => {}, { queue: 'emails' });
```

`WORKER_STARTED` / `WORKER_STOPPED` name the same thing from the other side: this process began or
stopped claiming the queue in their `{ queue }` payload.
