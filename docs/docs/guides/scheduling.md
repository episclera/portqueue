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

A recurring add creates/updates a **recurring producer**; `data` + the job options become
the **template** for every produced run. `schedule.cron` is either a bare expression string
(evaluated in UTC) or `{ pattern, tz }` for a timezone:

```ts
const reportsQueue = pq.createQueue('reports');
const result = await reportsQueue.addJob({
  data: { kind: 'sales' },       // template for each run
  priority: 5,                   // job options apply to each run
  schedule: { cron: { pattern: '0 8 * * 1-5', tz: 'America/New_York' } },
});
// Bare UTC form: schedule: { cron: '0 8 * * 1-5' }
// reportsJob.jobId is absent (no concrete job yet); reportsJob.scheduleId is stamped on every produced job;
// reportsJob.nextRunAt is the first run time.
```

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

The key spans **both the job and the schedule tables**. Whenever an `idempotencyKey` is supplied,
`addJob` first looks for any existing job _or_ schedule on that queue carrying the same key; if one
exists, nothing new is created and the existing entity is returned with `deduplicated: true` and
`deduplicationReason: 'IDEMPOTENCY'`. This holds regardless of the two adds' shapes:

- A recurring add whose key already belongs to a **one-off job** is deduped against that job
  (`reportsJob.jobId` is the existing job; no schedule is created).
- A plain one-off add whose key already belongs to a **schedule** is deduped against that schedule
  (`reportsJob.scheduleId` is the existing schedule; no job is enqueued) — the key checks the schedule
  table even when the new add has no recurring options at all.

Without an `idempotencyKey`, no cross-table check happens and every add creates a fresh job or
schedule. `getSchedules()` surfaces each schedule's `idempotencyKey` for inspection.

## Inspecting & unscheduling

Unschedule a **recurring** definition by its `scheduleId`:

```ts
const reportsQueue = pq.createQueue('reports');
await reportsQueue.getSchedules();               // list recurring definitions (each has a scheduleId)
await reportsQueue.removeSchedule({ scheduleId: reportsJob.scheduleId });
```

`removeSchedule` applies **only to recurring schedules** — it stops future production but does
**not** delete jobs already produced (remove those by id or status if you want). It is its own
method (not `removeJob`) per the entity-naming rule: a method names the one entity it acts on.

For a **one-off** job there is no schedule to remove — use the job-level methods instead:
`queue.cancelJob({ jobId })` to cancel a not-yet-active job, or `queue.removeJob({ jobId })` to
delete the row outright. See [Cancel a job](./producing-jobs.mdx#cancel-a-job) and
[Remove jobs & schedules](./producing-jobs.mdx#remove-jobs--schedules).
