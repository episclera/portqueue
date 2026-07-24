---
id: scheduling
title: Delayed & recurring jobs
sidebar_label: Delayed & recurring jobs
description: Schedule delayed, recurring, and cron jobs with PortQueue — fixed intervals, timezone-aware cron, and idempotent recurrences, all from addJob.
keywords: [portqueue, job queue, cron, delayed jobs, recurring jobs, scheduling, background jobs, node.js]
---

# Delayed & recurring jobs

Scheduling lives on `addJob` itself — there is **no separate `schedule()` method**. One
method covers one-off and recurring production, selected by which prop you set under the
`schedule` group:

| `schedule` prop | Mode |
|---|---|
| _(none / omit `schedule`)_ | one-off, runs immediately |
| `schedule.startAfter` | one-off, delayed |
| `schedule.startEvery` | recurring, fixed interval |
| `schedule.cron` | recurring, cron expression |

The three timing props are **mutually exclusive** (and `startAfter` never combines with a
recurring mode).

## Delayed (one-off)

`schedule.startAfter` takes a `Duration` (relative to now) or an absolute `Date`:

```ts
const emailsQueue = pq.createQueue('emails');
await emailsQueue.addJob({ data, schedule: { startAfter: '24h' } });
await emailsQueue.addJob({ data, schedule: { startAfter: new Date('2026-08-01T09:00:00Z') } });
```

## Recurring — cron with timezone

A recurring add creates/updates a **recurring producer**; `data` **and every job option you pass**
become the **template** for each produced run. `schedule.cron` is either a bare expression string
(evaluated in UTC) or `{ pattern, tz }` for a timezone:

```ts
const reportsQueue = pq.createQueue('reports');
const result = await reportsQueue.addJob({
  data: { kind: 'sales' },       // template for each run
  priority: 5,                   // job options apply to each run
  retry: { maxAttempts: 3 },     // …as do retry, backoff, expireIn, retention, etc.
  schedule: { cron: { pattern: '0 8 * * 1-5', tz: 'America/New_York' } },
});
// Bare UTC form: schedule: { cron: '0 8 * * 1-5' }
// reportsJob.jobId is absent (no concrete job yet); reportsJob.scheduleId is stamped on every produced job;
// reportsJob.nextRunAt is the first run time.
```

:::note Options shape the spawned jobs, not the schedule
A schedule **spawns a new job** on each tick, and **every option** you pass to the recurring
`addJob` — `priority`, `retry`/`backoff`, `expireIn`, `retention`, `singletonKey`,
`preferredInstanceKeyPattern` — is carried onto each spawned job. These govern the **produced
jobs**, never the schedule itself: `expireIn` bounds how long each run may wait before it starts
(re-applied relative to that run), `retention` controls how long each finished run is kept, and so
on. The schedule keeps firing regardless. (One exception: `idempotencyKey` is **not** copied to the
runs — otherwise a schedule could only ever produce its first job.)
:::

**Identical schedules are allowed.** Re-adding the same `schedule.cron`/`schedule.startEvery` on a
queue creates a **new, independent schedule** — PortQueue does not deduplicate by recurrence pattern.
If you want a queue to fire the same pattern twice (say, two different payload templates on the same
cron), just add it twice. To keep exactly one, opt in with an `idempotencyKey` (next section).

## Recurring — fixed interval

```ts
const healthchecksQueue = pq.createQueue('healthchecks');
await healthchecksQueue.addJob({ data: {}, schedule: { startEvery: '30s' } });
```

## Deduplicating with `idempotencyKey`

Because identical recurrences coexist, the way to guarantee **only one** producer is to give it an
`idempotencyKey`. The key is the dedup identity, scoped to the queue, and it is **first-writer-wins**:

```ts
const reportsQueue = pq.createQueue('reports');
const first = await reportsQueue.addJob({ data: { kind: 'sales' }, schedule: { cron: '0 8 * * *' }, idempotencyKey: 'daily-sales' });
const second = await reportsQueue.addJob({ data: { kind: 'sales' }, schedule: { cron: '0 8 * * *' }, idempotencyKey: 'daily-sales' });
// secondJob.deduplicated === true; secondJob.scheduleId === firstJob.scheduleId.
// The existing schedule is kept **unchanged** — a re-add never mutates it.
```

The key is **per entity**: a one-off `addJob` dedups against the **jobs** table, and a recurring
`addJob` (with `cron`/`startEvery`) dedups against the **schedule** table. `addJob` looks only in
the table that matches the add's shape; if a matching entity already carries the key, nothing new
is created and the existing one is returned with `deduplicated: true` and
`deduplicationReason: 'IDEMPOTENCY'`.

- A **recurring** add dedups only against existing **schedules** — a one-off job with the same key
  never blocks it.
- A **one-off** add dedups only against existing **jobs** — a schedule with the same key never
  blocks it.

So a one-off job and a schedule may safely share a key on the same queue; they never dedup against
each other. And the per-run jobs a schedule produces are **not** stamped with the key — otherwise a
recurring schedule could only ever produce its first run — so those runs never collide with the
schedule's own key.

Without an `idempotencyKey`, every add creates a fresh job or schedule. `getSchedules()` surfaces
each schedule's `idempotencyKey` for inspection.

## Unscheduling

Unschedule a **recurring** definition by its `scheduleId`:

```ts
const reportsQueue = pq.createQueue('reports');
await reportsQueue.removeSchedule({ scheduleId: reportsJob.scheduleId });
```

`removeSchedule` applies **only to recurring schedules** — it stops future production but does
**not** delete jobs already produced (remove those by id or status if you want). It is its own
method (not `removeJob`) per the entity-naming rule: a method names the one entity it acts on.

For a **one-off** job there is no schedule to remove — use the job-level methods instead:
`queue.cancelJob({ jobId })` to cancel a not-yet-active job, or `queue.removeJob({ jobId })` to
delete the row outright. See [Cancel a job](./producing-jobs.mdx#cancel-a-job) and
[Remove jobs](./producing-jobs.mdx#remove-jobs).

## Inspecting

List a queue's recurring definitions — each carries the `scheduleId` you pass to `removeSchedule`:

```ts
const reportsQueue = pq.createQueue('reports');
const schedules = await reportsQueue.getSchedules(); // recurring definitions, each with a scheduleId
```
