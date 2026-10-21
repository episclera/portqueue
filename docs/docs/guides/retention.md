---
id: retention
title: Retention & cleanup
sidebar_label: Retention
description: Control how long PortQueue keeps finished jobs — set queue and per-job TTL retention, prune the job table automatically, and keep failed jobs for triage.
keywords: [portqueue, job queue, retention, cleanup, database queue, background jobs, postgresql queue, node.js]
---

# Retention & cleanup

By default PortQueue **keeps jobs forever**. For any real workload you should turn on
retention (or your own pruning) so the `job` table doesn't grow unbounded.

Retention resolves per-job (queue → job precedence) and is frozen onto each `job` row when the job is
added. Set it at the **queue** level (there is no client-wide default — nothing is silently
inherited) and override per job when a specific job needs to live longer.

## Turning retention on

`RetentionOptions` is `{ ttlSeconds: number; statuses?: JobStatus[] }` — a TTL and, optionally, the
finished statuses it covers. Setting `retention` *is* asking for deletion; omitting it is asking for
nothing to be deleted. There is no mode to choose between the two.

```ts
// per-queue default
pq.createQueue({
  name: 'emails',
  retention: { ttlSeconds: 259_200 }, // delete 3 days after a job finishes
  handler: async (job) => send(job.data),
});

// per-job override (highest precedence) — keep this one longer
await pq.addJob({ queue: 'emails', data, retention: { ttlSeconds: 2_592_000 } }); // 30 days
```

- **`ttlSeconds`** — how many **seconds** after a job **finishes** before it is deleted. Like every
  PortQueue duration it is a plain number of seconds — `604_800` for a week — so there is no unit
  string to misread.
- **`statuses`** — which finished statuses the policy applies to. **Omit it and every finished status
  is covered** (`COMPLETED`, `FAILED`, `CANCELLED`, `EXPIRED`). Name a subset to narrow it — with
  `statuses: [JobStatus.COMPLETED]`, failed and cancelled jobs are kept regardless of their TTL, which
  is the usual shape when you want a failure to stay around for triage:

  ```ts
  pq.createQueue({
    name: 'emails',
    retention: {
      ttlSeconds: 259_200,
      statuses: [JobStatus.COMPLETED], // sweep the successes; keep the failures
    },
    handler: async (job) => send(job.data),
  });
  ```

Retention is settable at the **queue** level (`QueueOptions.retention`) and overridden per job
(`JobOptions.retention`, highest precedence). A `retention` object **replaces** rather than merges: a
per-job policy is the whole policy, so a job that names `ttlSeconds` and no `statuses` covers every
finished status even if its queue narrowed them.

Like every other retention field, `statuses` is resolved **when the job is added** and frozen onto its
row. Changing a queue's policy therefore governs the jobs added after it, never the ones already
queued — which is the same rule `ttlSeconds` follows, and the reason the sweeper never has to re-read
a queue's live options.

Retention only ever acts on **finished** jobs — those with status `COMPLETED`, `FAILED`,
`CANCELLED`, or `EXPIRED` (and only when the job carries a TTL that has elapsed). Jobs still in
flight — `PENDING`, `ACTIVE` (including an `ACTIVE` row whose lock has lapsed, which reads as
`stalled`) and `RETRY` — are **never touched** by retention.

:::info Keep failed jobs longer
There is **no dead-letter queue** — failed jobs stay in `job` with status `FAILED` for
triage. Keep completed jobs short and failed jobs longer so you always have failures to
inspect and re-run with `retryJob`.
:::

## When pruning runs

Retention sweeps run on the shared **maintenance tick**, controlled by `tickIntervalSeconds`
(default **5 seconds**). Each sweep hard-deletes finished, TTL-elapsed jobs in **bounded batches**
(500 rows per iteration, up to 20 iterations per sweep) so the `job` table is never long-locked.
The sweep is **cluster-coordinated** — it runs on the same tick across instances rather than once
per process. **In-flight / unfinished jobs are never removed** by retention.

## Manual pruning

Manual pruning is always available:

```ts
import { JobStatus } from '@portqueue/core';

await pq.removeJobs({ queue: 'emails', statuses: [JobStatus.COMPLETED] });
```
