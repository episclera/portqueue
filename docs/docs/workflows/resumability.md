---
id: resumability
title: Resumability, retries & inspection
sidebar_label: Resumability & retries
---

# Resumability, retries & inspection

## Crash mid-step

Each step is a separate `job` row sharing a `workflowId`. When `VALIDATE` finishes it
**spawns** the `CHARGE` job. If the process dies while `CHARGE` runs, that job's lock
lapses and it is **reclaimed and re-run on any instance** — no re-validate, no lost
progress (completed steps are already their own `COMPLETED` rows). This is why each step
must be [idempotent](../core-concepts/at-least-once.md).

## Per-step retries & backoff

Retry policy applies per step's job — the same `retryMaxAttempts` / `retryDelay` /
`retryBackoff` options as any job. A step that keeps failing exhausts its attempts and
the run halts at that step (a `FAILED` row you can inspect and retry).

## What carries over vs resets

When the next step is spawned, its **input is `job.data`** — the value the current step
passed via `step.next({ data })` (or the unchanged current `data` if omitted). The
previous step's output is stored as its own `return_value`. Per-step retry counters
reset for the newly spawned step's job; carried business data is exactly what you passed
forward.

## Retrying a whole run

```ts
import { RetryMode } from '@portqueue/core';

// re-arm the failed step's own job with its persisted data (default)
await pq.createQueue('orders').retryJob({ jobId, from: RetryMode.FROM_FAILED_STEP });

// start a fresh run from the entry step under a new workflowId,
// seeded from the original run's entry-step data
await pq.createQueue('orders').retryJob({ jobId, from: RetryMode.FROM_START });
```

:::tip Why there is no arbitrary-step selector
Skipping to an arbitrary step would feed it the *wrong* carried-over input and skip
prior side effects. So retries are only `FROM_FAILED_STEP` or `FROM_START` — the two
choices that are always consistent.
:::

## Inspecting

```ts
const run = await pq.getWorkflow({ workflowId });
// ordered list of JobSnapshots: each step's status, timings, data (input),
// return_value (output), and failure_message.
```

The [dashboard](../dashboard.mdx) renders this run view directly.
