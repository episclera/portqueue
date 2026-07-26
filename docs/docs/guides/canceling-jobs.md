---
id: canceling-jobs
title: Canceling jobs
sidebar_label: Canceling jobs
description: Cancel pending, delayed, or running jobs with PortQueue using cooperative AbortSignal handlers — stop work without deleting rows in Node.js.
keywords: [portqueue, job queue, cancel jobs, abortsignal, workers, background jobs, typescript, node.js]
---

# Canceling jobs

Canceling **stops a job from running** — whether it's waiting in the queue, scheduled for later,
or executing right now. It never deletes rows (that's
[`removeJob`](./producing-jobs.mdx#remove-jobs)). One method covers every case:

```ts
await emailsQueue.cancelJob({ jobId });
```

- **Pending** — the job is marked `CANCELLED` and will never be claimed.
- **Delayed / scheduled to run later** (non-recurring) — same: it's marked `CANCELLED` before its
  scheduled start time arrives, so it never becomes eligible. For a **recurring** schedule, cancel the
  recurrence with [`removeSchedule`](./producing-jobs.mdx#remove-a-schedule) instead.
- **Already running on this instance** — its handler's `AbortSignal` (`job.signal`) is fired.
  Cancellation is then **cooperative**: the handler has to notice the signal and stop. A handler
  that ignores `job.signal` runs to completion regardless.

`cancelJob` returns `true` if it either marked a job cancelled or signalled a running one.

:::warning Signalling a running job is instance-local
`cancelJob` fires the handler's `AbortSignal` **only when the job is running on the same instance
(this process)**. In a multi-instance fleet, if the job is currently running on a **different**
instance, `cancelJob` **cannot** reach that remote handler — the job keeps running there until it
finishes on its own. Remote cancellation only works on jobs that **haven't started**: a
pending/delayed row is marked `CANCELLED` so it never starts, no matter which instance calls
`cancelJob`. To reliably stop in-flight work across a fleet, write abort-aware handlers **and**
don't assume `cancelJob` from another node will interrupt an already-running job.
:::

:::info Recurring jobs
`cancelJob` cancels a single job instance, not a recurrence. To stop a **recurring schedule** from
producing new jobs, delete the schedule with
[`removeSchedule`](./producing-jobs.mdx#remove-a-schedule) — canceling one produced run won't
prevent the next.
:::

## Honor the signal in a handler

`job.signal` is a standard [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal).
It also fires on graceful-shutdown timeout, so honoring it makes your handlers both cancellable
**and** shutdown-friendly. A few patterns:

### Pattern 1 — Listen for `abort`, then throw on the way out

Some work takes no signal and offers no checkpoints — a third-party client call, one long `await`
you don't control. Add an `abort` listener that stops whatever *you* own, throw the `AbortError`
once the body is done, and drop the listener at the end:

```ts
handler: async (job) => {
  const client = openThirdPartyClient();

  // Stop the work from here; a `throw` inside this listener couldn't reach the handler.
  const onAbort = () => client.cancel();
  job.signal.addEventListener('abort', onAbort);

  try {
    const result = await client.run(job.data);
    job.signal.throwIfAborted(); // cancelled mid-run → throws the AbortError, failing the job
    return result;
  } finally {
    job.signal.removeEventListener('abort', onAbort); // body finished — drop the listener
  }
};
```

`throwIfAborted()` is the throw: listener callbacks are called by the runtime, so nothing is
awaiting them and a `throw` in there would just be an uncaught exception. Reach for
[Pattern 2](#pattern-2--pass-it-straight-to-abortable-apis) whenever the API takes a signal itself —
then you need neither the listener nor the check.

:::info A rejected handler is a normal failure
Throwing the `AbortError` fails the job, so your **retry policy still applies** and a cancelled job
can come back. To make cancellation final, add it to the worker's `dontAutoretryFor`
(`dontAutoretryFor: ['AbortError']`), or `return` early instead of throwing as in
[Pattern 3](#pattern-3--check-between-steps-of-long-work).
:::

### Pattern 2 — Pass it straight to abortable APIs

`fetch`, many DB clients, and other signal-aware APIs — forward `job.signal` and they throw
`AbortError` the moment it fires:

```ts
pq.createWorker({
  queue: 'sync',
  handler: async (job) => {
    const res = await fetch(`https://api.example.com/sync/${job.data.id}`, { signal: job.signal });
    return res.json();
  },
});
```

### Pattern 3 — Check between steps of long work

For a loop or a multi-stage job, test the signal at safe checkpoints and bail out early:

```ts
handler: async (job) => {
  for (const row of job.data.rows) {
    if (job.signal.aborted) return; // stop cleanly at the next boundary
    await process(row);
  }
};
```

### Pattern 4 — Tear down long-lived work on abort

When you own a subscription, stream, or observable, wire its teardown to the signal's `abort`
event so cancellation unwinds resources deterministically:

```ts
import { fromEvent, takeUntil, lastValueFrom } from 'rxjs';

handler: async (job) => {
  // Complete the stream as soon as the job is cancelled — its teardown (unsubscribe,
  // close sockets, …) runs automatically.
  const abort$ = fromEvent(job.signal, 'abort');
  await lastValueFrom(buildProcessingStream(job.data).pipe(takeUntil(abort$)));
};
```

## Cancel vs. remove vs. pause

| You want to… | Use |
|---|---|
| Stop a specific job (pending or running) | [`cancelJob`](./producing-jobs.mdx#cancel-a-job) |
| Stop a recurring schedule producing new jobs | [`removeSchedule`](./producing-jobs.mdx#remove-a-schedule) |
| Delete job rows for cleanup | [`removeJob` / `removeJobs`](./producing-jobs.mdx#remove-jobs) |
| Stop the whole queue temporarily | [`pause` / `resume`](./producing-jobs.mdx#pause--resume-the-queue) |
