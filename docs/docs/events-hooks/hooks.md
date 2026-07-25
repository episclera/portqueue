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
  handler: ({ queue, options }) => tracer.tag(queue, options.data),
});
```

## `HookPhase`

Each phase receives a **different context object** — destructure exactly what that phase provides:

| Phase | Context | When | Can do |
|---|---|---|---|
| `BEFORE_ADD` | `{ queue, options }` | Before a job is inserted (inside your `tx` if one was passed) | Return a `BeforeAddResult` (`{ options }`) to mutate `AddJobOptions`/`data`; throw to **veto** the add |
| `AFTER_ADD` | `{ result }` | After insert | React to the `AddJobResult` (still awaited) |
| `BEFORE_PROCESS` | `{ job }` | Before a handler runs | Enrich context; throw to **skip** the job |
| `AFTER_PROCESS` | `{ job, outcome }` | After a handler settles | Inspect the `ProcessOutcome` (`completed` / `failed` / `retry`) |

- `queue` is the queue name (string); `options` is the `AddJobOptions` about to be added (`options.data`, `options.idempotencyKey`, `options.schedule`, …).
- `result` is the `AddJobResult` (`result.jobId`, `result.queue`, `result.deduplicated`, …).
- `job` is the live `Job` handle (`job.id`, `job.queue`, `job.data`, `job.signal`, …).

## Mutate an outgoing job

`BEFORE_ADD` receives `{ queue, options }` and returns `{ options }` with the fields to override:

```ts
pq.useHook({
  phase: HookPhase.BEFORE_ADD,
  handler: ({ queue, options }) => ({
    options: {
      data: { ...(options.data as Record<string, unknown>), tenantId: currentTenant() },
      idempotencyKey: options.idempotencyKey ?? `tenant:${currentTenant()}:${queue}`,
    },
  }),
});
```

## Veto / authorize

```ts
pq.useHook({
  phase: HookPhase.BEFORE_ADD,
  handler: ({ queue, options }) => {
    if (!authorized(queue, options.data)) throw new Error('not authorized to enqueue');
  },
});
```

## Observe outcomes (spans, metrics)

```ts
pq.useHook({ phase: HookPhase.BEFORE_PROCESS, handler: ({ job }) => tracer.startSpan(job.queue) });
pq.useHook({ phase: HookPhase.AFTER_PROCESS, handler: ({ job, outcome }) => tracer.endSpan(job.id, outcome.kind) });
```

`BEFORE_ADD` runs **inside** the caller's transaction when a `tx` is used, so a veto
rolls back with the surrounding write. See the decision rule on
[Events vs Hooks](./events-vs-hooks.md).
