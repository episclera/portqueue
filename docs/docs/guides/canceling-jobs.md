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
  `startAfter` time arrives, so it never becomes eligible. For a **recurring** schedule, cancel the
  recurrence with [`removeSchedule`](./producing-jobs.mdx#remove-a-schedule) instead.
- **Already running on this instance** — its handler's `AbortSignal` (`job.signal`) is fired.
  Cancellation is then **cooperative**: the handler has to notice the signal and stop. A handler
  that ignores `job.signal` runs to completion regardless.

`cancelJob` returns `true` if it either marked a job cancelled or signalled a running one.

:::note Recurring jobs
`cancelJob` cancels a single job instance, not a recurrence. To stop a **recurring schedule** from
producing new jobs, delete the schedule with
[`removeSchedule`](./producing-jobs.mdx#remove-a-schedule) — canceling one produced run won't
prevent the next.
:::

## Honor the signal in a handler

`job.signal` is a standard [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal).
It also fires on graceful-shutdown timeout, so honoring it makes your handlers both cancellable
**and** shutdown-friendly. A few patterns:

### Pattern 1 — Make a timer abortable

A bare `setTimeout` ignores cancellation and keeps a stopped job "running" until it fires.
Wrap it in a promise that rejects on `job.signal`, and clear the timer at the end so it never
leaks — whether the wait completed or the job was cancelled mid-wait:

```ts
handler: async (job) => {
  let timer: ReturnType<typeof setTimeout>;
  try {
    // Wait up to 30s, but bail out the instant the job is cancelled.
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(resolve, 30_000);
      job.signal.addEventListener(
        'abort',
        () => reject(job.signal.reason), // throws the AbortError, stopping the handler
        { once: true },
      );
    });
  } finally {
    clearTimeout(timer!); // all good (or aborted) — cancel the pending timeout
  }

  // ...continue once the wait finished normally.
};
```

### Pattern 2 — Pass it straight to abortable APIs

`fetch`, many DB clients, and timers accept a signal — forward `job.signal` and they throw
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

The same shape works without RxJS — register a listener and clean up by hand:

```ts
handler: async (job) => {
  const sub = source.subscribe(onData);
  job.signal.addEventListener('abort', () => sub.unsubscribe(), { once: true });
  await sub.completed;
};
```

## Cancel vs. remove vs. pause

| You want to… | Use |
|---|---|
| Stop a specific job (pending or running) | [`cancelJob`](./producing-jobs.mdx#cancel-a-job) |
| Stop a recurring schedule producing new jobs | [`removeSchedule`](./producing-jobs.mdx#remove-a-schedule) |
| Delete job rows for cleanup | [`removeJob` / `removeJobs`](./producing-jobs.mdx#remove-jobs) |
| Stop the whole queue temporarily | [`pause` / `resume`](./producing-jobs.mdx#pause--resume-the-queue) |
