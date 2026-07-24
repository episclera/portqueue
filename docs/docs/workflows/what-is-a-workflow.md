---
id: what-is-a-workflow
title: What a workflow is
sidebar_label: What a workflow is
---

# What a workflow is

A **workflow** is a multi-step job. Its mental model:

> An ordered set of steps where **each step is its own job row** sharing a `workflowId`.
> Completing a step **spawns** the next step's job.

That is the entire idea. A workflow queue differs from a simple queue in exactly one
way: its worker's `handler` is an **ordered array of steps** instead of a single
function. **Producing is the same `addJob({ data })`** in both cases.

## The shape

```ts
import type { WorkflowStep } from '@portqueue/core';

enum OrderStep { VALIDATE = 'VALIDATE', CHARGE = 'CHARGE', SHIP = 'SHIP', NOTIFY = 'NOTIFY' }

const orderSteps: WorkflowStep[] = [
  { key: OrderStep.VALIDATE, handler: async (job, step) => step.next({ data: await validate(job.data) }) },
  { key: OrderStep.CHARGE,   handler: async (job, step) => step.next({ data: await charge(job.data) }) },
  { key: OrderStep.SHIP,     handler: async (job, step) => step.next({ data: await ship(job.data) }) },
  { key: OrderStep.NOTIFY,   handler: async (job, step) => step.done({ result: await notify(job.data) }) },
];

// A workflow worker is just a worker whose `handler` is the steps array.
pq.createWorker({ queue: 'orders', handler: orderSteps });
```

The array **order is the canonical sequence**: `steps[0]` is the entry step and defines
what comes next. Each step's **input is `job.data`** (what the previous step carried
over); its output is what it passes forward via the `step` controller.

Continue with [Designing a workflow](./designing.md).

## Why not numeric progress? {#why}

:::tip Why we chose this
BullMQ-style numeric progress can't **resume**: a crash at 60% has no way to pick up
mid-way. By making each step its own claimable `job` row, an un-advanced step is just a
job any instance can reclaim and re-run — the completed steps are already their own
`COMPLETED` rows. This resumes exactly where it stopped, load-balances across instances,
and is fully introspectable in the dashboard with no JSON progress log.
:::
