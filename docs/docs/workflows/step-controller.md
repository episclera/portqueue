---
id: step-controller
title: The step controller
sidebar_label: Step controller
---

# The step controller

A step handler has the shape `(job, step) => Promise<StepOutcome>`. **The `step`
controller — not the `job` — owns transitions.** It has exactly three outcomes.

| Outcome | What it does |
|---|---|
| `step.next({ to?, data? })` | Advance. Next key is the next step in declared order, or an explicit `to` jump. `data` becomes the next step's input (and this step's `return_value`); defaults to the current `data` carried unchanged. |
| `step.repeat({ data?, delayMs? })` | Spawn another job for the **same** step, optionally delayed — e.g. poll a status until ready. |
| `step.done({ result? })` | Finish the whole run. `result` is the workflow's final value. |

Each outcome completes this step's job and — except for `done` — **atomically spawns**
the next step's job.

## A worked pipeline: validate → charge → ship → notify

```ts
import type { WorkflowStep } from '@portqueue/core';

enum OrderStep { VALIDATE = 'VALIDATE', CHARGE = 'CHARGE', SHIP = 'SHIP', NOTIFY = 'NOTIFY' }

const orderSteps: WorkflowStep[] = [
  {
    key: OrderStep.VALIDATE,
    handler: async (job, step) => {
      const validated = await validate(job.data);
      return step.next({ data: validated });        // → CHARGE (next in order)
    },
  },
  {
    key: OrderStep.CHARGE,
    handler: async (job, step) => {
      const charged = await charge(job.data);
      return step.next({ data: charged });           // → SHIP
    },
  },
  {
    key: OrderStep.SHIP,
    handler: async (job, step) => {
      const shipment = await ship(job.data);
      if (!shipment.ready) return step.repeat({ delayMs: 60_000 }); // poll again in 1m
      return step.next({ data: shipment });          // → NOTIFY
    },
  },
  {
    key: OrderStep.NOTIFY,
    handler: async (job, step) => step.done({ result: await notify(job.data) }),
  },
];

pq.createWorker({ queue: 'orders', handler: orderSteps });
```

To skip ahead, pass `to`: `step.next({ to: OrderStep.SHIP })`.

## Inspecting a run

There is **no** `stepsHistory` field on `Job` — each step is its own queryable row.
Fetch the whole run to read earlier outputs or render a timeline:

```ts
const run = await pq.getWorkflow({ workflowId }); // ordered list of JobSnapshots
```
