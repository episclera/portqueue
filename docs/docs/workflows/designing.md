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

Because delivery is [at-least-once](../core-concepts/at-least-once.md), any step can run
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

Next: sharing the definition across tiers, on [the step controller](./step-controller.md) page.

## Sharing the definition across tiers

`defineWorkflow({ queue, steps })` is a **pure** factory (no I/O). It validates unique
keys, records the ordered steps and the entry step, and is imported by **both** tiers:

```ts
// worker tier — consume (many steps)
pq.createWorker(orderWorkflow);

// producer tier — starting a run is just add({ data })
const orders = pq.createQueue(orderWorkflow);
const { workflowId } = await orders.addJob({ data: { cartId } });
```

Step keys and their order are a single source of truth across the produce/consume split.
