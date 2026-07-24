---
id: hooks
title: Hooks reference
sidebar_label: Hooks
description: PortQueue hooks let you participate in an operation — awaited in order to mutate an outgoing job, enrich context, or veto an add or process by throwing.
keywords: [portqueue, hooks, lifecycle, background jobs, job queue, observability, node.js, typescript]
---

# Hooks reference

Hooks let you **participate** in an operation — they are **awaited in registration
order**, can **mutate** the outgoing job, and can **veto** by throwing. Register with
`pq.useHook`, which returns an unsubscribe function.

```ts
import { HookPhase } from '@portqueue/core';

const off = pq.useHook({
  phase: HookPhase.BEFORE_ADD,
  handler: ({ job }) => tracer.tag(job),
});
```

## `HookPhase`

| Phase | When | Can do |
|---|---|---|
| `BEFORE_ADD` | Before a job is inserted (inside your `tx` if one was passed) | Return a `BeforeAddResult` to mutate `AddJobOptions`/`data`; throw to **veto** the add |
| `AFTER_ADD` | After insert | React (still awaited) |
| `BEFORE_PROCESS` | Before a handler runs | Enrich context; throw to **skip** the job |
| `AFTER_PROCESS` | After a handler settles | Inspect the `ProcessOutcome` (`completed` / `failed` / `retry`) |

## Mutate an outgoing job

```ts
pq.useHook({
  phase: HookPhase.BEFORE_ADD,
  handler: ({ job }) => ({
    options: {
      data: { ...job.data, tenantId: currentTenant() },
      idempotencyKey: job.idempotencyKey ?? `tenant:${currentTenant()}:${job.data.id}`,
    },
  }),
});
```

## Veto / authorize

```ts
pq.useHook({
  phase: HookPhase.BEFORE_ADD,
  handler: ({ job }) => {
    if (!authorized(job)) throw new Error('not authorized to enqueue');
  },
});
```

## Observe outcomes (spans, metrics)

```ts
pq.useHook({ phase: HookPhase.BEFORE_PROCESS, handler: ({ job }) => tracer.startSpan(job.queue) });
pq.useHook({ phase: HookPhase.AFTER_PROCESS, handler: ({ outcome }) => tracer.endSpan(outcome.kind) });
```

`BEFORE_ADD` runs **inside** the caller's transaction when a `tx` is used, so a veto
rolls back with the surrounding write. See the decision rule on
[Events vs Hooks](./events-vs-hooks.md).
