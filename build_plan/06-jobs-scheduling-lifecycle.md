# 06 — Jobs, Scheduling & Lifecycle

This file defines job states, transitions, and the semantics of delays, retries/backoff, priority, idempotency/singleton, recurring (cron/every) jobs, multi-step jobs, retention, and dead-lettering. It builds on the data model (file 04) and public API (file 05).

## 06.1 `JobState` enum & transitions

`JobState` (exported, `UPPER_SNAKE_CASE` keys and values):

- `CREATED` — inserted, waiting to become due / be claimed.
- `ACTIVE` — claimed by an instance, handler running (has a `locked_until` deadline).
- `COMPLETED` — handler resolved.
- `FAILED` — handler threw and attempts are exhausted (terminal; may be `dead_letter`).
- `RETRY` — handler threw but attempts remain; scheduled to run again at `available_at`. (Kept as a distinct state so the dashboard can show "waiting to retry" vs "fresh".)
- `CANCELLED` — cancelled before running.
- `EXPIRED` — passed `expire_at` before starting.

**Derived (not stored) status:** `STALLED` — a row in `ACTIVE` whose `locked_until < now()`. Computed in reads; the reclaimer returns it to `CREATED`/`RETRY`.

**Transitions:**
```
CREATED ──claim──▶ ACTIVE ──ok──▶ COMPLETED
   ▲                  │
   │              throw, attempts left
   │                  ▼
   └───retry-due──── RETRY
                      │  throw, attempts exhausted
ACTIVE ──lock expired (stalled)──▶ reclaim ▶ CREATED/RETRY
ACTIVE/throw-exhausted ─────────────────────▶ FAILED (dead_letter?)
CREATED ──cancel──▶ CANCELLED
CREATED ──past expire_at──▶ EXPIRED
```

Every transition emits an event (file 08) and is performed by a single atomic driver call so concurrent instances can't corrupt state.

## 06.2 Delivery guarantee

**At-least-once.** A job runs at least once; under crash/stall it may run again (the visibility timeout reclaims it). Handlers should be **idempotent**. This is stated prominently in the docs, with `idempotencyKey`/`singletonKey` and multi-step `stepData` offered as the tools to make handlers safe. At-most-once is explicitly *not* offered because it can't be guaranteed with crash recovery.

## 06.3 Delays & availability

- `delay` / `startAfter` set `available_at` in the future. A job is claimable only when `available_at <= now()`.
- Delayed jobs are found by the same claim query (it already filters on `available_at`), plus the safety poll wakes the loop when the nearest future job becomes due (the subscriber computes the next wake time from `min(available_at)`).
- `expireIn`/`expire_at`: a job still `CREATED`/`RETRY` past its `expire_at` must be expired **before** it ever runs. Because the stalled-reclaimer only scans `ACTIVE` rows, expiry of *due-but-unstarted* jobs is a **separate sweep**: the driver exposes `expireDueJobs({ queue?, now })` (marks `CREATED`/`RETRY` rows with `expire_at <= now` as `EXPIRED`), owned by the **SchedulerService tick** (it already runs on an interval and is cluster-coordinated). Also, the claim query filters out rows past `expire_at` so a racing claim never runs an expired job. This closes the gap where neither the reclaimer nor the claim path owned expiry.

## 06.4 Retries & backoff

- On handler throw with attempts remaining: `attempt++`, state → `RETRY`, `available_at = now + backoff(attempt)`, error captured into the typed `last_error_*` columns.
- `BackoffStrategy`:
  - `FIXED` — `retryDelay` each time.
  - `EXPONENTIAL` — `retryDelay * factor^(attempt-1)`, capped at `maxDelay`, with optional `jitter` (full/equal jitter) to avoid thundering herds across instances.
- Attempts exhausted → `FAILED`. If the queue has a `deadLetterQueue`, the failed job is copied/moved there (a new job on that queue carrying the original payload + failure metadata) and/or marked `dead_letter=true`. Document exactly one behavior: **mark `dead_letter=true` and, if a DLQ is configured, also enqueue a job onto it** so both introspection and reprocessing work.

## 06.5 Priority

- Integer `priority`, higher runs sooner. The claim ordering is `priority DESC, available_at ASC` (backed by `ix_job_claim`).
- Priority is a per-job option (queue can default it). No separate priority queues — one table, ordered claim.

## 06.6 Idempotency & singleton

- **`idempotencyKey`** — unique per `(queue, idempotencyKey)`. `add` with a colliding key does **not** insert; it returns the existing job with `deduplicated: true`. Enforced by the DB unique constraint (file 04), not app logic, so it's race-safe across instances. This also underpins **idempotent scheduling** — a schedule `key` maps to the same guarantee for recurring definitions.
- **`singletonKey`** — at most one *active/pending* job with this key at a time (pg-boss "singleton" semantics). Enforced by a partial unique index over active states. Adding another while one is in flight is rejected/deduped (documented behavior: returns the in-flight job with `deduplicated: true`).
- Both are surfaced in `AddJobResult` (`deduplicated: true`), and `deduplicationReason` (`IDEMPOTENCY | SINGLETON`) tells the caller which guard fired.

## 06.7 Recurring jobs — cron & every

Design principle (from raw plan): **a recurring definition produces new distinct jobs; it never mutates one job in place.** All runs share the definition's `schedule_id`.

- `queue.schedule({ key, cron | every, timezone?, data?, jobOptions? })` upserts a `schedule` row (idempotent on `(queue, key)`).
- The **`SchedulerService`** (one logical runner across the cluster) periodically finds schedules whose `next_run_at <= now()`, and for each: inserts a concrete `job` stamped with `schedule_id`, then advances `next_run_at` using the cron/every calculation. Insert + advance happen in one transaction so a crash can't double-produce or skip.
- **Cluster coordination:** to avoid N instances each producing the same run, the scheduler tick claims due schedules with the same `SKIP LOCKED`/atomic-update mechanism as jobs (or holds an advisory lock where available). Producing is therefore exactly-once per scheduled tick even with many instances.
- **`every`** accepts ms or a duration string; **`cron`** accepts standard 5-field (and optional 6-field seconds) expressions.
- **Cron parser scope (committed here, not deferred):** implement a small internal, dependency-free parser supporting the 5-field standard (minute hour day-of-month month day-of-week), optional leading seconds field (6-field), ranges (`1-5`), lists (`1,3,5`), steps (`*/10`), and `*`. Advanced specials `L` / `#` / `W` / `?` are **out of scope for v1** and must throw a clear `INVALID_OPTIONS` error naming the unsupported token (documented). This bounds the parser so it stays fully testable (file 16).
- **Timezones:** cron `next_run_at` is computed in the schedule's IANA `timezone` (default UTC), correctly handling DST using `Intl`/`Temporal` (no `moment`/`luxon` runtime dep). Document that `every` is wall-clock-interval and unaffected by tz.
- **Missed-run / catch-up policy:** if the scheduler was down and a schedule's `next_run_at` is in the past (possibly for several firing times), it **fires once** and advances `next_run_at` to the next future slot — it does **not** backfill every missed occurrence (which would flood the queue after an outage). This is stated in the docs because it's a common production surprise; `every` schedules likewise fire once and resume from now.
- **Naming:** the raw plan floated `repeat_delay`/`repeat_id`/`cron_id`. Final decision: the public option is **`schedule`** with `cron`/`every`; the correlation id is **`scheduleId`** (covers both cron and interval). This reads cleaner than `repeat_delay` and unifies both modes. Documented as the "repeat/cron id."

## 06.8 Multi-step jobs (resumable; replaces progress)

The raw plan explicitly rejects BullMQ-style numeric progress because it can't resume. PortQueue models durable, resumable work as a **step machine**.

- A multi-step worker is created with `steps: StepHandlerMap` instead of `handler`. `StepHandlerMap` maps a **developer-defined `StepId` enum** value → a step handler. Steps are predefined at worker creation (raw plan: "multiple steps predefined at the start, use enums for steps").
- The job row carries `step` (current step) and `step_data` (state carried between steps). On each claim, the `StepMachineService` runs the handler for the job's current `step`.
- **Canonical step-handler signature:** `(job: Job<TData>, step: StepController) => Promise<StepOutcome>`. Transitions live on the **`step` controller argument** (not on `job`, and not by returning a bare object) — this is the single model used across files 05, 06, and 19. A step handler returns exactly one of the controller's outcomes (named options, no positional args):
  - `step.next(stepId, { data })` — advance to `stepId`, persist `data` as the new `step_data`. The job stays in the queue and is re-claimed for the next step (so each step is an independent, crash-safe unit of work — this is how it resumes).
  - `step.repeat({ data?, delayMs? })` — re-run the **same** step (raw plan: "allow repeating at a sudden step"), optionally after a delay, optionally updating `step_data`.
  - `step.done(result)` — finish the whole job (`COMPLETED`), storing `result`.
- Between steps, the transition (`advanceStep`) is atomic; if the instance crashes after step N completes but before step N+1 starts, the job simply resumes at N+1 on another instance using the persisted `step_data`. **This is the resumability numeric progress lacks.**
- `total_steps`/`completed_steps` are maintained for display only.
- Calling step-only controls on a single-function worker (or vice-versa) throws a typed `UnsupportedForWorkerTypeError` — the method exists so it's discoverable (raw-plan rule).

## 06.9 Retention & cleanup

- `RetentionOptions`: `mode: RetentionMode` (`KEEP_FOREVER` (default) | `DELETE_AFTER` | `ARCHIVE_AFTER`), `ttl?: Duration`, `states?: JobState[]` (which finished states the policy applies to — default `COMPLETED`; failed jobs often kept longer).
- **Default is keep-forever** (raw-plan requirement). Nothing is deleted unless the operator opts in.
- The **`RetentionService`** runs on an interval (cluster-coordinated like the scheduler), deleting/archiving finished jobs older than `ttl` in **bounded batches** (so it never long-locks the table). `ARCHIVE_AFTER` moves rows into `job_archive` (the optional 5th table) before deletion window; `DELETE_AFTER` hard-deletes.
- Retention can be set at client, queue, or job level (job wins), so a single critical job can be retained even if the queue purges aggressively.

## 06.10 Instance attribution

Each run records `run_on_instance_id` + `run_on_instance_type` (file 04/07) so the dashboard can show "how many jobs each server/container ran." Resolved once per process by `InstanceIdentityService` (file 07).

## 06.11 Local final-check checklist

- [ ] All state transitions are single atomic driver calls; safe under N instances.
- [ ] At-least-once is documented; idempotency/singleton/step tools are offered to make handlers safe.
- [ ] Backoff supports fixed + exponential with jitter and a cap.
- [ ] Recurring definitions produce distinct jobs sharing `scheduleId`; production is exactly-once per tick across the cluster.
- [ ] Cron is timezone-aware (DST-correct) with no heavy date dependency.
- [ ] Multi-step resumes from persisted `stepData` after a crash; `next`/`repeat`/`done` outcomes exist; repeating a step is supported.
- [ ] Retention defaults to keep-forever; cleanup runs in bounded batches; job-level retention overrides.
- [ ] Dead-letter behavior is documented and consistent (`dead_letter` flag + optional DLQ enqueue).
