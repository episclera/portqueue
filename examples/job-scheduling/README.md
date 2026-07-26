# job-scheduling

Delayed (one-off) and recurring (interval + cron) jobs with [`@portqueue/core`](../../packages/core).
Backed by PGLite (file-backed under the repo-root `tmp/`), so there's no database to install.

Scheduling lives on `addJob` itself — there is **no separate `schedule()` method**. Which prop you
set under the `schedule` group selects the mode:

| `schedule` prop | Mode |
| --- | --- |
| _(omit `schedule`)_ | one-off, runs immediately |
| `schedule.startAfterSeconds` | one-off, delayed by N seconds |
| `schedule.startEverySeconds` | recurring, fixed interval in seconds |
| `schedule.cron` | recurring, cron expression |

## Delayed (one-off) — [`delayed.ts`](./delayed.ts)

Enqueues three reminders (now, +3s, and at an absolute `Date`), runs them, then exits.

```bash
npm run example:schedule-delayed   # from the repo root
# or, from this folder:
npm run delayed
```

## Recurring — [`recurring.ts`](./recurring.ts)

A healthcheck every 3 seconds (`startEverySeconds`) and a sales report every 5 seconds (`cron`, 6-field
form with a leading seconds field). It waits until **each** recurrence has fired at least 3 times
(~15s), unschedules both and exits; Ctrl+C stops it earlier. Each schedule uses an `idempotencyKey`
so re-running the script against the same persisted database keeps exactly one schedule.

Two details the example makes visible:

- **The tick sets the resolution.** Due runs are materialized on the client tick (`tickIntervalSeconds`,
  5s by default), so the example lowers it to 1s for the 3s interval to land on time. Production
  rarely needs that.
- **PortQueue never holds your process open.** Every internal timer is `unref`'d, so a script with
  nothing else on the event loop would exit immediately after scheduling — the example awaits the
  runs it is waiting for.

A recurring `addJob` returns a `scheduleId` — the example logs it and then uses it to
`queue.removeSchedule({ scheduleId })` at the end. Persist it somewhere durable if you might later
want to stop new runs being spawned for that interval/cron.

```bash
npm run example:schedule-recurring   # from the repo root
# or, from this folder:
npm run recurring
```
