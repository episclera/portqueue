---
id: producing-jobs
title: Producing jobs
sidebar_label: Producing jobs
---

# Producing jobs

All producing goes through a `Queue` handle. Every method takes **one options object**
and returns a **result object**.

## Add one, or many

```ts
const emails = pq.createQueue<{ to: string }>('emails');

await emails.addJob({ data: { to: 'a@b.com' } });

await emails.addJobs({
  jobs: [{ data: { to: 'a@b.com' } }, { data: { to: 'c@d.com' } }],
}); // one round-trip where the engine allows
```

`AddJobResult` carries `jobId`, `queue`, `status`, `deduplicated`, `startAfter`, and —
for scheduled or workflow adds — `scheduleId` / `nextRunAt` / `workflowId`.

## Scheduling

All timing lives under the `schedule` group — pass exactly one mode:

```ts
await emails.addJob({ data, schedule: { startAfter: '24h' } });                 // Duration string
await emails.addJob({ data, schedule: { startAfter: new Date('2026-08-01T09:00:00Z') } });
await emails.addJob({ data, schedule: { startEvery: '30s' } });                 // recurring interval
await emails.addJob({ data, schedule: { cron: '0 8 * * 1-5' } });               // recurring cron (UTC)
await emails.addJob({ data, schedule: { cron: { pattern: '0 8 * * 1-5', tz: 'America/New_York' } } });
```

- `schedule.startAfter` — delay a **one-off** job: a `Duration` from now, or an absolute `Date`.
- `schedule.startEvery` — a **recurring** fixed interval (a `Duration` between runs).
- `schedule.cron` — a **recurring** cron expression, a bare string (UTC) or `{ pattern, tz }`.

Pick **exactly one** recurring mode, and `startAfter` can't be combined with a recurring mode.
Omit `schedule` to run immediately. See [Delayed & recurring jobs](./scheduling.md) for the full
recurring story (dedup, timezones, unscheduling).

## Priority

```ts
await emails.addJob({ data, priority: 10 }); // higher values are claimed first
```

`priority` orders ready jobs — higher values run sooner. It composes with scheduling: a job
becomes eligible at its `schedule.startAfter` time, then priority breaks ties among the ready set.

## Idempotency & singleton

Both keys are **queue-scoped**, but they solve different problems:

- **`idempotencyKey`** — a *first-writer-wins dedup identity*. The first add with a given key
  creates the job (or schedule); any later add with the same key on that queue returns the
  **existing** entity **unchanged** (`deduplicated: true`, `deduplicationReason: 'IDEMPOTENCY'`)
  and creates nothing. The check spans **both** the job and schedule tables, so a plain add and a
  recurring add sharing a key still collapse to one entity. Use it to guarantee an operation is
  enqueued **at most once ever** (per key).
- **`singletonKey`** — *at most one active/pending job at a time* for that key. Unlike
  `idempotencyKey`, it does not pin a permanent identity: once the job finishes, a new add with
  the same key can enqueue again. Use it to prevent a **second concurrent** run (e.g. one reindex
  per tenant at a time), while still allowing the next run later.

```ts
const payments = pq.createQueue('payments');
const result = await payments.addJob({ data: { orderId }, idempotencyKey: `charge:${orderId}` });
if (result.deduplicated) logger.info('already queued', { jobId: result.jobId }); // charged at most once

const reindex = pq.createQueue('reindex');
await reindex.addJob({ data, singletonKey: `reindex:${tenantId}` }); // one live reindex per tenant
```

## Transactional enqueue

Pass a `tx` adapter so the insert joins **your** transaction — the job exists only if
your business write commits. See [Transactions](./transactions.mdx).

```ts
import { fromKnex } from '@portqueue/core/tx';

await knex.transaction(async (trx) => {
  await trx('order').insert(order);
  const fulfillment = pq.createQueue('fulfillment');
  await fulfillment.addJob({ data: { orderId }, tx: fromKnex(trx) });
});
```

## Controlling produced jobs

The `Queue` handle exposes the full control surface. Every method takes one options object.

**Inspect**

```ts
const snapshot = await emails.getJob({ jobId });                 // JobSnapshot | null
const page = await emails.getJobs({ statuses: [JobStatus.FAILED] }); // cursor-paged
const stats = await emails.getQueueStats();                      // per-status counts
const schedules = await emails.getSchedules();                   // recurring definitions
```

**Retry & cancel**

```ts
// Requeue a failed/completed job. `from` (a RetryMode) defaults to FROM_FAILED_STEP;
// FROM_START begins a fresh workflow run from the entry step.
await emails.retryJob({ jobId, from: RetryMode.FROM_START });

// Cancel a not-yet-active (pending/delayed) job.
await emails.cancelJob({ jobId });

// Cooperatively signal an already-running job via its handler's AbortSignal.
await emails.cancelRunningJob({ jobId });
```

**Remove**

```ts
await emails.removeJob({ jobId });                       // one job (accepts tx)
await emails.removeJobs({ jobIds: [a, b] });             // by id
await emails.removeJobs({ statuses: [JobStatus.COMPLETED] }); // by status
await emails.purgeJobs({ statuses: [JobStatus.FAILED] });     // bulk delete by status
await emails.removeSchedule({ scheduleId });             // stop a recurring definition
```

`removeSchedule` only affects **recurring** schedules — for one-off jobs use `cancelJob` /
`removeJob`. See [Delayed & recurring jobs](./scheduling.md#inspecting--unscheduling).

**Queue control** (persisted, cluster-wide)

```ts
await emails.pause({ mode: PauseMode.PROCESSING }); // stop claiming; still accepts adds (default)
await emails.pause({ mode: PauseMode.ALL });        // also refuse new adds (drain)
await emails.resume();
```
