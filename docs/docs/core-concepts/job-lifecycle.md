---
id: job-lifecycle
title: Job lifecycle & states
sidebar_label: Job lifecycle
---

# Job lifecycle & states

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

## The Job context

The object passed to a handler is a read-only view of the row plus a few control methods.

```ts
pq.createWorker({
  queue: QueueName.Emails,
  handler: async (job) => {
    job.id;              // string
    job.queue;           // string
    job.data;            // TData — the payload
    job.retryAttempt;    // number
    job.metadata;        // opaque JSON (traceId, tenantId, …)
    job.signal;          // AbortSignal — fires on graceful-shutdown timeout
    await job.extendLock({ byMs: 30_000 }); // override the automatic heartbeat
  },
});
```

Long-running handlers should observe `job.signal` so they can bail when a graceful
shutdown times out (v1 runs handlers on the main event loop; a job can't be force-killed).

## Claiming & visibility timeout

Jobs are claimed with row-level locking (`SKIP LOCKED` where available) so N instances
never double-process. A claim is invisible to other instances for a **visibility
timeout** (`lockDurationMs`, default ~30s), refreshed by an automatic heartbeat. If a
process dies mid-job, the lock lapses and the job becomes `STALLED` — reclaimable
elsewhere. This is the *acks-late* model: a job isn't "done" until the handler confirms.
