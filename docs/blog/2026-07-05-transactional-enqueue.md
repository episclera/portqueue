---
slug: transactional-enqueue-dual-write
title: 'Transactional enqueue: killing the dual-write bug'
authors: [gheorghe]
tags: [design, transactions]
---

You write an order row, then enqueue its fulfillment job. What happens if the process
dies between the two? Or the transaction rolls back after the job was queued? You get a
job referencing data that doesn't exist — the **dual-write bug**.

<!-- truncate -->

## The fix: join the developer's transaction

PortQueue lets the job insert run **inside your own transaction**. The job exists **iff**
your business write commits, and the `NOTIFY` that wakes workers fires only **after**
commit.

```ts
import { fromKnex } from '@portqueue/core/tx';

await knex.transaction(async (trx) => {
  await trx('order').insert(order);
  const fulfillment = pq.createQueue('fulfillment');
  await fulfillment.addJob({ data: { orderId }, tx: fromKnex(trx) });
}); // your trx owns commit/rollback
```

## Why PortQueue never owns the transaction

There is no `pq.transaction(fn)` and no `adoptTransaction`. You start the transaction
with your ORM or query-builder, wrap it with a small **adapter** (`fromKnex`, `fromPg`,
`fromPrisma`, `fromDrizzle`, …), and pass it as `tx`. Keeping ownership in your code means
the queue never surprises you by committing early or holding a connection.

Read the full [Transactions guide](/docs/guides/transactions).
