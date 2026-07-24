# job-scheduling

Delayed (one-off) and recurring (interval + cron) jobs with [`@portqueue/core`](../../packages/core).
Backed by PGLite (file-backed under the repo-root `tmp/`), so there's no database to install.

Scheduling lives on `addJob` itself — there is **no separate `schedule()` method**. Which prop you
set under the `schedule` group selects the mode:

| `schedule` prop | Mode |
| --- | --- |
| _(omit `schedule`)_ | one-off, runs immediately |
| `schedule.startAfter` | one-off, delayed (`Duration` or `Date`) |
| `schedule.startEvery` | recurring, fixed interval |
| `schedule.cron` | recurring, cron expression |

## Delayed (one-off) — [`delayed.ts`](./delayed.ts)

Enqueues three reminders (now, +3s, and at an absolute `Date`), runs them, then exits.

```bash
npm run example:schedule-delayed   # from the repo root
# or, from this folder:
npm run delayed
```

## Recurring — [`recurring.ts`](./recurring.ts)

A healthcheck every 3 seconds (`startEvery`) and a sales report every minute (`cron`). Runs until
Ctrl+C. Each schedule uses an `idempotencyKey` so re-running the script against the same persisted
database keeps exactly one schedule.

```bash
npm run example:schedule-recurring   # from the repo root
# or, from this folder:
npm run recurring
```
