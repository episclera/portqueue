---
id: designing
title: Designing a workflow
sidebar_label: Designing
---

# Designing a workflow

Good workflow design comes down to a few habits.

## 1. Define a `StepKey` enum

Explicit, unique keys — no magic strings. The keys become the workflow's routing.

```ts
enum OrderStep { VALIDATE = 'VALIDATE', CHARGE = 'CHARGE', SHIP = 'SHIP', NOTIFY = 'NOTIFY' }
```

## 2. Order the `steps` array (entry step first)

The array order **is** the sequence. `steps[0]` is where a run starts and where a
`FROM_START` retry resets to. Write **one handler per step**.

## 3. Keep every handler idempotent

Because delivery is [at-least-once](../guides/consuming-jobs.md#at-least-once--idempotency), any step can run
twice. Design each step as **one crash-safe unit of external side effect** — e.g.
"charge the card" is a single step, guarded by an idempotency key against your payment
provider.

## 4. Decide what each step passes forward

`step.next({ data })` becomes the next step's `job.data` (and is stored as this step's
`return_value`). If you omit `data`, the current `data` carries over unchanged. Keep the
carried value the minimal thing the next step needs — avoid hidden cross-step state.

## 5. Choose granularity, name, and control flow

- **Granularity:** each step = one crash-safe external side effect. Don't bundle two
  network calls into one step if a crash between them would double-charge.
- **Repeat** a step (poll until ready) with `step.repeat({ delayMs })`.
- **Finish** the whole run with `step.done({ result })`.

Next: how transitions work, on [the step controller](./step-controller.md) page.

## Producing and consuming a workflow

A workflow lives entirely on the worker: pass the ordered `steps` array as the worker's
`handler`. There is no separate definition object to import — the worker validates unique
keys and records the entry step (`steps[0]`), and the producer picks it up automatically.

```ts
import type { WorkflowStep } from '@portqueue/core';

const orderSteps: WorkflowStep[] = [
  /* { key, handler } — one per step, entry step first */
];

// worker tier — consume (handler is the ordered steps array)
pq.createWorker({ queue: 'orders', handler: orderSteps });

// producer tier — starting a run is just add({ data })
const orders = pq.createQueue('orders');
const { workflowId } = await orders.addJob({ data: { cartId } });
```

Step keys and their order are the single source of truth for the run.
