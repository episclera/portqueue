---
id: at-least-once
title: At-least-once & idempotency
sidebar_label: At-least-once
---

# At-least-once & idempotency

PortQueue guarantees **at-least-once** delivery: a job is processed at least once, and
under crash/retry conditions may run more than once. This is the same trade-off Celery's
*acks-late* model makes — it favors never *losing* work over never *repeating* it.

**The rule:** assume any handler can run twice. Make handlers **idempotent** — running
them a second time with the same input produces the same result and no duplicate side
effects.

## Two dedup guards on the producer side

```ts
// idempotencyKey — never insert a duplicate job for the same logical action
const payments = pq.createQueue('payments');
const r = await payments.addJob({
  data: { orderId },
  idempotencyKey: `charge:${orderId}`,
});
if (r.deduplicated) {
  // r.jobId is the existing job; nothing new was inserted
  // r.deduplicationReason === DeduplicationReason.IDEMPOTENCY
}

// singletonKey — at most one *active* job with this key at a time
const reindex = pq.createQueue('reindex');
await reindex.addJob({ data: { tenantId }, singletonKey: `reindex:${tenantId}` });
```

- `idempotencyKey` prevents inserting a duplicate row (dedup at enqueue).
- `singletonKey` prevents more than one active job with the key (dedup at run).

## Producer / consumer split

Producing and consuming are separate objects so they can run on different servers.
A producer-only tier (an API) just calls `createQueue(...).addJob(...)`; a worker tier
calls `createWorker(...)`. Both are built from the same config, so they agree on the
queue without coordination. See [The model](./model.md).
