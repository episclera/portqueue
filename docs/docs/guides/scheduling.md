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

**No key required.** The recurrence pattern _is_ the identity: re-adding the same
`cron`/`startEvery` on a queue **updates** that schedule; a different pattern creates a
new one.

## Recurring — fixed interval

```ts
const healthchecks = pq.createQueue('healthchecks');
await healthchecks.addJob({ data: {}, startEvery: '30s' });
```

## Inspecting & unscheduling

```ts
const reports = pq.createQueue('reports');
await reports.getSchedules();               // list recurring definitions
await reports.removeSchedule({ scheduleId: r.scheduleId });
```

`removeSchedule` stops future production but does **not** delete jobs already produced —
remove those by id or status if you want. Unscheduling is its own method (not
`removeJob`) per the entity-naming rule: a method names the one entity it acts on.
