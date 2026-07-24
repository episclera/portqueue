---
id: canceling-jobs
title: Canceling jobs
sidebar_label: Canceling jobs
---

# Canceling jobs

Canceling **stops a job from running** — whether it's waiting in the queue, scheduled for later,
or executing right now. It never deletes rows (that's
[`removeJob`](./producing-jobs.mdx#remove-jobs--schedules)). One method covers every case:

```ts
await emailsQueue.cancelJob({ jobId });
```

- **Pending** — the job is marked `CANCELLED` and will never be claimed.
- **Delayed / scheduled to run later** — same: it's marked `CANCELLED` before its `startAfter`
  time arrives, so it never becomes eligible.
- **Already running on this instance** — its handler's `AbortSignal` (`job.signal`) is fired.
  Cancellation is then **cooperative**: the handler has to notice the signal and stop. A handler
  that ignores `job.signal` runs to completion regardless.

`cancelJob` returns `true` if it either marked a job cancelled or signalled a running one.

:::note Recurring jobs
`cancelJob` cancels a single job instance, not a recurrence. To stop a **recurring schedule** from
producing new jobs, delete the schedule with
[`removeSchedule`](./producing-jobs.mdx#remove-jobs--schedules) — canceling one produced run won't
prevent the next.
:::

:::info Running jobs are cancelled where they run
The abort signal only reaches a handler executing **in this process**. Firing it is a local,
in-memory action — there's no cross-instance "cancel running job" RPC. To stop a job running on
another server, cancel it there, or design handlers to check a shared flag.
:::

## Honor the signal in a handler

`job.signal` is a standard [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal).
It also fires on graceful-shutdown timeout, so honoring it makes your handlers both cancellable
**and** shutdown-friendly. A few patterns:

### Pass it straight to abortable APIs

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

### Check between steps of long work

For a loop or a multi-stage job, test the signal at safe checkpoints and bail out early:

```ts
handler: async (job) => {
  for (const row of job.data.rows) {
    if (job.signal.aborted) return; // stop cleanly at the next boundary
    await process(row);
  }
};
```

### Tear down long-lived work on abort

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
| Stop a recurring schedule producing new jobs | [`removeSchedule`](./producing-jobs.mdx#remove-jobs--schedules) |
| Delete job rows for cleanup | [`removeJob` / `removeJobs`](./producing-jobs.mdx#remove-jobs--schedules) |
| Stop the whole queue temporarily | [`pause` / `resume`](./producing-jobs.mdx#pause--resume-the-queue) |
