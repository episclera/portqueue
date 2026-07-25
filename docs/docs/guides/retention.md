---
id: retention
title: Retention & cleanup
sidebar_label: Retention
description: Control how long PortQueue keeps finished jobs — set queue and per-job TTL retention, prune the job table automatically, and keep failed jobs for triage.
keywords: [portqueue, job queue, retention, cleanup, database queue, background jobs, postgres queue, node.js]
---

# Retention & cleanup

By default PortQueue **keeps jobs forever**. For any real workload you should turn on
retention (or your own pruning) so the `job` table doesn't grow unbounded.

Retention resolves per-job (queue → job precedence) and is frozen onto each
`job` row when it finishes. Set it at the **queue** level (there is no client-wide default —
nothing is silently inherited) and override per job when a specific job needs to live longer.

## Retention modes

`RetentionMode` has exactly **two** values:

| `RetentionMode` | Meaning |
|---|---|
| `KEEP_FOREVER` | **Default.** Finished jobs are never pruned. |
| `DELETE_AFTER` | Finished jobs become eligible for deletion once their `ttl` has elapsed. |

```ts
import { RetentionMode } from '@portqueue/core';

// per-queue default
const emailsQueue = pq.createQueue('emails', {
  retention: { mode: RetentionMode.DELETE_AFTER, ttl: '3d' },
});

// per-job override (highest precedence) — keep this one longer
await emailsQueue.addJob({ data, retention: { mode: RetentionMode.DELETE_AFTER, ttl: '30d' } });
```

`RetentionOptions` is `{ mode: RetentionMode; ttl?: Duration; statuses?: JobStatus[] }`:

- **`ttl`** — how long after a job **finishes** before it may be deleted. **Required** for
  `DELETE_AFTER`; ignored for `KEEP_FOREVER`. It's a `Duration` (units `ms`/`s`/`m`/`h`/`d`,
  decimals ok, or a plain number of milliseconds).
- **`statuses`** — which finished statuses the policy applies to. **Defaults to `[COMPLETED]`**,
  so failed/cancelled/expired jobs are kept unless you list them explicitly.

Retention is settable at the **queue** level (`QueueOptions.retention`) and overridden per job
(`JobOptions.retention`, highest precedence).

:::info No count-based retention
PortQueue only supports **TTL-based** deletion via `DELETE_AFTER`. There is **no** count-based
retention — nothing like BullMQ's `removeOnComplete: { count: N }`. If you need to cap the number of
rows, use TTL and/or manual pruning (below).
:::

Retention only ever acts on **finished** jobs — those with status `COMPLETED`, `FAILED`,
`CANCELLED`, or `EXPIRED` (and only when their resolved retention is `DELETE_AFTER` and the
TTL has elapsed). Jobs still in flight — `PENDING`, `ACTIVE`, `RETRY`, and the derived
`STALLED` status — are **never touched** by retention.

:::info Keep failed jobs longer
There is **no dead-letter queue** — failed jobs stay in `job` with status `FAILED` for
triage. Keep completed jobs short and failed jobs longer so you always have failures to
inspect and re-run with `retryJob`.
:::

## When pruning runs

Retention sweeps run on the shared **maintenance tick**, controlled by `tickIntervalMs`
(default **5000ms**). Each sweep hard-deletes finished, TTL-elapsed jobs in **bounded batches**
(500 rows per iteration, up to 20 iterations per sweep) so the `job` table is never long-locked.
The sweep is **cluster-coordinated** — it runs on the same tick across instances rather than once
per process. **In-flight / unfinished jobs are never removed** by retention.

## Manual pruning

Manual pruning is always available:

```ts
import { JobStatus } from '@portqueue/core';

const emailsQueue = pq.createQueue('emails');
await emailsQueue.removeJobs({ statuses: [JobStatus.COMPLETED] });
```
