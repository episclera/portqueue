---
id: events
title: Events reference
sidebar_label: Events
description: PortQueue emits typed, non-blocking lifecycle events on the client — subscribe with pq.on for job, schedule, worker, and system signals.
keywords: [portqueue, events, lifecycle, observability, job queue, node.js, typescript]
---

# Events reference

Events are emitted on the `PortQueue` client and observed with `pq.on` / `once` / `off`.
Every listener receives one **typed payload object** (named fields, no positional args).
Fan-out is **non-blocking** — the bus never waits for listeners. There is no
`WorkerEvent`; all events are global on the client.

```ts
import { PortQueueEvent } from '@portqueue/core';

const off = pq.on(PortQueueEvent.JOB_FAILED, ({ queue, jobId, error, retryAttempt }) => {
  metrics.failures.inc({ queue });
}, { queue: 'orders' }); // optional queue filter (typed to TQueues)

off(); // unsubscribe
pq.once(PortQueueEvent.CLIENT_STARTED, () => {});
```

## `PortQueueEvent`

**Client / lifecycle**

- `CLIENT_STARTED`, `CLIENT_STOPPING`, `CLIENT_STOPPED`
- `MIGRATION_APPLIED` — `{ from, to }`
- `ERROR` — `{ error, source }` — any swallowed internal error surfaces here, so nothing is truly silent. **Subscribe to this in production.**

**Job lifecycle**

- `JOB_ADDED` — `{ jobId, queue, deduplicated }`
- `JOB_ACTIVE` — `{ jobId, queue, retryAttempt, instanceKey }`
- `JOB_COMPLETED` — `{ jobId, queue, returnValue, durationMs }`
- `JOB_FAILED` — failure after attempts exhausted
- `JOB_RETRYING` — scheduled for another attempt
- `JOB_STALLED` — lock lapsed, reclaimable
- `JOB_EXPIRED`, `JOB_CANCELLED`, `JOB_REMOVED`

**Schedules**

- `SCHEDULE_CREATED`, `SCHEDULE_UPDATED`, `SCHEDULE_REMOVED`, `SCHEDULE_FIRED`

**Queue & worker**

- `QUEUE_PAUSED`, `QUEUE_RESUMED`
- `WORKER_STARTED`, `WORKER_STOPPED`

**System pressure**

- `SYSTEM_PRESSURE_HIGH`, `SYSTEM_PRESSURE_NORMAL`

:::info Events can't change anything
Events are for observation only. To mutate or block an operation, use a
[hook](./hooks.md).
:::
