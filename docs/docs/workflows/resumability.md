---
id: resumability
title: Resumability, retries & inspection
sidebar_label: Resumability & retries
description: PortQueue workflows resume exactly where they crashed — each step is its own job row, reclaimed and re-run on any instance with per-step retries.
keywords: [portqueue, workflows, resumability, durable execution, retries, multi-step jobs, node.js, typescript]
---

# Resumability, retries & inspection

## Crash mid-step

Each step is a separate `job` row sharing a `workflowId`. When `VALIDATE` finishes it
**spawns** the `CHARGE` job. If the process dies while `CHARGE` runs, that job's lock
lapses and it is **reclaimed and re-run on any instance** — no re-validate, no lost
progress (completed steps are already their own `COMPLETED` rows). This is why each step
must be [idempotent](../guides/consuming-jobs.md#at-least-once--idempotency).

## Per-step retries & backoff

Retry policy applies per step's job — the same `retry` options
(`{ maxAttempts, delay, backoff }`) as any job. A step that keeps failing exhausts its attempts and
the run halts at that step (a `FAILED` row you can inspect and retry).

## What carries over vs resets

When the next step is spawned, its **input is `job.data`** — the value the current step
passed via `step.next({ data })` (or the unchanged current `data` if omitted). The
previous step's output is stored as its own `return_value`. Per-step retry counters
reset for the newly spawned step's job; carried business data is exactly what you passed
forward.

## Retrying or replaying a run

Because each step is its own job, there are two independent, always-consistent operations — and
no arbitrary-step selector (skipping to a middle step would feed it the *wrong* carried-over input
and skip prior side effects):

```ts
const ordersQueue = pq.createQueue('orders');

// 1) Resume: retry the FAILED STEP's own job — it re-runs with its persisted data,
//    then the run continues to the remaining steps.
await ordersQueue.retryJob({ jobId: failedStepJobId });

// 2) Replay from the start: just add a new job — a workflow queue begins at the entry step.
//    The result carries the new run's workflowId.
const { workflowId } = await ordersQueue.addJob({ data: originalInput });
```

Retrying re-arms the step you name; a full replay is a brand-new run you start with `addJob`
(supplying the input), so the two never get confused.

## Inspecting

```ts
const run = await pq.getWorkflow({ workflowId });
// ordered list of JobSnapshots: each step's status, timings, data (input),
// return_value (output), and failure_message.
```

The [dashboard](../dashboard.mdx) renders this run view directly.
