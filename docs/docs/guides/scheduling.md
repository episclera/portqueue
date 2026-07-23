---
id: scheduling
title: Scheduling & recurring jobs
sidebar_label: Scheduling
---

# Scheduling

Scheduling lives on `addJob` itself — there is **no separate `schedule()` method**. One
method covers one-off and recurring production, selected by which timing prop you pass:

| Prop | Mode |
|---|---|
| _(none)_ | one-off, runs immediately |
| `startAfter` | one-off, delayed |
| `startEvery` | recurring, fixed interval |
| `cron` | recurring, cron expression |

The three timing props are **mutually exclusive**.

## Delayed (one-off)

`startAfter` takes a `Duration` (relative to now) or an absolute `Date`:

```ts
const emails = pq.createQueue('emails');
await emails.addJob({ data, startAfter: '24h' });
await emails.addJob({ data, startAfter: new Date('2026-08-01T09:00:00Z') });
```

## Recurring — cron with timezone

A recurring add creates/updates a **recurring producer**; `data` + the job options become
the **template** for every produced run. `cron` is either a bare expression string
(evaluated in UTC) or `{ pattern, tz }` for a timezone:

```ts
const reports = pq.createQueue('reports');
const r = await reports.addJob({
  data: { kind: 'sales' },       // template for each run
  priority: 5,                   // job options apply to each run
  cron: { pattern: '0 8 * * 1-5', tz: 'America/New_York' },
});
// Bare UTC form: cron: '0 8 * * 1-5'
// r.jobId is absent (no concrete job yet); r.scheduleId is stamped on every produced job;
// r.nextRunAt is the first run time.
```

**Identical schedules are allowed.** Re-adding the same `cron`/`startEvery` on a queue creates a
**new, independent schedule** — PortQueue does not deduplicate by recurrence pattern. If you want a
queue to fire the same pattern twice (say, two different payload templates on the same cron), just
add it twice. To keep exactly one, opt in with an `idempotencyKey` (next section).

## Recurring — fixed interval

```ts
const healthchecks = pq.createQueue('healthchecks');
await healthchecks.addJob({ data: {}, startEvery: '30s' });
```

## Deduplicating with `idempotencyKey`

Because identical recurrences coexist, the way to guarantee **only one** producer is to give it an
`idempotencyKey`. The key is the dedup identity, scoped to the queue, and it is **first-writer-wins**:

```ts
const reports = pq.createQueue('reports');
const a = await reports.addJob({ data: { kind: 'sales' }, cron: '0 8 * * *', idempotencyKey: 'daily-sales' });
const b = await reports.addJob({ data: { kind: 'sales' }, cron: '0 8 * * *', idempotencyKey: 'daily-sales' });
// b.deduplicated === true; b.scheduleId === a.scheduleId.
// The existing schedule is kept **unchanged** — a re-add never mutates it.
```

The key spans **both the job and the schedule tables**. Whenever an `idempotencyKey` is supplied,
`addJob` first looks for any existing job _or_ schedule on that queue carrying the same key; if one
exists, nothing new is created and the existing entity is returned with `deduplicated: true` and
`deduplicationReason: 'IDEMPOTENCY'`. This holds regardless of the two adds' shapes:

- A recurring add whose key already belongs to a **one-off job** is deduped against that job
  (`result.jobId` is the existing job; no schedule is created).
- A plain one-off add whose key already belongs to a **schedule** is deduped against that schedule
  (`result.scheduleId` is the existing schedule; no job is enqueued) — the key checks the schedule
  table even when the new add has no recurring options at all.

Without an `idempotencyKey`, no cross-table check happens and every add creates a fresh job or
schedule. `getSchedules()` surfaces each schedule's `idempotencyKey` for inspection.

## Inspecting & unscheduling

```ts
const reports = pq.createQueue('reports');
await reports.getSchedules();               // list recurring definitions
await reports.removeSchedule({ scheduleId: r.scheduleId });
```

`removeSchedule` stops future production but does **not** delete jobs already produced —
remove those by id or status if you want. Unscheduling is its own method (not
`removeJob`) per the entity-naming rule: a method names the one entity it acts on.
