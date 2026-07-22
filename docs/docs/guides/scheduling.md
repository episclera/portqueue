---
id: scheduling
title: Scheduling (delayed, cron & every)
sidebar_label: Scheduling
---

# Scheduling

Scheduling is **the `schedule` option on `addJob`** — there is **no separate
`schedule()` method**. One method covers one-off and recurring production.

## Delayed (one-off)

```ts
await pq.createQueue('emails').addJob({ data, delay: '24h' });
await pq.createQueue('emails').addJob({ data, startAfter: new Date('2026-08-01T09:00:00Z') });
```

## Recurring — cron with timezone

Passing `schedule` makes `addJob` create/update a **recurring producer**; `data` + the
job options become the **template** for every produced run.

```ts
const r = await pq.createQueue('reports').addJob({
  data: { kind: 'sales' },       // template for each run
  priority: 5,                   // job options apply to each run
  schedule: {
    key: 'daily-sales',          // idempotent per (queue, key) — re-adding updates
    cron: '0 8 * * 1-5',
    timezone: 'America/New_York',
  },
});
// r.jobId is absent (no concrete job yet); r.scheduleId is stamped on every produced job;
// r.nextRunAt is the first run time.
```

`ScheduleSpec` requires exactly **one of** `cron` **or** `every` — never both, never
neither.

## Recurring — fixed interval

```ts
await pq.createQueue('healthchecks').addJob({ data: {}, schedule: { key: 'ping', every: '30s' } });
```

## Inspecting & unscheduling

```ts
await pq.createQueue('reports').getSchedules();               // list recurring definitions
await pq.createQueue('reports').removeSchedule({ scheduleId: r.scheduleId });
```

`removeSchedule` stops future production but does **not** delete jobs already produced —
remove those by id or status if you want. Unscheduling is its own method (not
`removeJob`) per the entity-naming rule: a method names the one entity it acts on.
