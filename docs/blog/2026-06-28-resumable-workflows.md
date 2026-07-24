---
slug: resumable-workflows-no-numeric-progress
title: Resumable workflows (and why we skipped numeric progress)
authors: [gheorghe]
tags: [design, workflows]
description: How PortQueue models resumable, crash-safe workflows as one job row per step, so a pipeline recovers exactly where it stopped without numeric progress.
keywords: [portqueue, workflows, resumable workflows, background jobs, job queue, node.js, typescript, bullmq alternative]
---

An order pipeline — validate, charge, ship, notify — should survive a crash. If the
process dies while charging, you must **not** re-validate, and you must **not** double
charge. Numeric progress can't do that. PortQueue models the pipeline as resumable steps.

<!-- truncate -->

## Each step is its own job row

A workflow is an ordered set of steps sharing a `workflowId`, where **each step is its
own `job` row**. Completing a step atomically **spawns** the next step's job.

```ts
import type { WorkflowStep } from '@portqueue/core';

enum OrderStep { VALIDATE = 'VALIDATE', CHARGE = 'CHARGE', SHIP = 'SHIP', NOTIFY = 'NOTIFY' }

const orderSteps: WorkflowStep[] = [
  { key: OrderStep.VALIDATE, handler: async (job, step) => step.next({ data: await validate(job.data) }) },
  { key: OrderStep.CHARGE,   handler: async (job, step) => step.next({ data: await charge(job.data) }) },
  { key: OrderStep.SHIP,     handler: async (job, step) => step.next({ data: await ship(job.data) }) },
  { key: OrderStep.NOTIFY,   handler: async (job, step) => step.done({ result: await notify(job.data) }) },
];

// A workflow is just a worker whose `handler` is the ordered steps array.
pq.createWorker({ queue: 'orders', handler: orderSteps });
```

## Why not numeric progress?

BullMQ-style `job.updateProgress(60)` records *how far* you got but not *how to resume* —
a crash at 60% has nowhere to pick up. With each step as its own claimable row, the
un-advanced step is just a job any instance reclaims and re-runs; completed steps are
already their own `COMPLETED` rows. It resumes exactly where it stopped, load-balances
across instances, and is fully introspectable — no JSON progress log.

Dive into the [Workflows](/docs/workflows/what-is-a-workflow) section.
