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

## Delayed start & priority

```ts
await emails.addJob({ data, startAfter: '24h' });               // Duration string
await emails.addJob({ data, startAfter: new Date('2026-08-01T09:00:00Z') });
await emails.addJob({ data, priority: 10 });                    // higher runs sooner
```

`startAfter` delays a **one-off** job (a `Duration` from now, or an absolute `Date`). For
**recurring** production use `startEvery` / `cron` — see [Delayed & recurring jobs](./scheduling.md).
`priority` orders ready jobs — higher values are claimed first.

## Idempotency & singleton

```ts
const payments = pq.createQueue('payments');
const r = await payments.addJob({ data: { orderId }, idempotencyKey: `charge:${orderId}` });
if (r.deduplicated) logger.info('already queued', { jobId: r.jobId });

const reindex = pq.createQueue('reindex');
await reindex.addJob({ data, singletonKey: `reindex:${tenantId}` });
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

:::info Jobs have no name
Unlike BullMQ's `add(name, data)`, PortQueue jobs carry **no per-job name**. This is
deliberate: developers routinely conflate a job name with the queue name, and it isn't
needed. Routing is the **queue's** job (one worker per queue), and multi-step routing is
the workflow [`StepKey`](../workflows/what-is-a-workflow.md) — not a job name. Labels and
correlation you genuinely want go in `metadata` (opaque, for tracing) or `idempotencyKey`
(dedup).
:::

## Controlling produced jobs

- `retryJob({ jobId, from? })` — requeue a failed/completed job (`RetryMode`).
- `cancelJob({ jobId })` — cancel a not-yet-active job.
- `cancelRunningJob({ jobId })` — cooperatively signal an active job via its `AbortSignal`.
- `removeJob({ jobId })` / `removeJobs({ jobIds })` / `purgeJobs({ statuses })`.
- `pause({ mode })` / `resume()` — persisted, cluster-wide processing control.
