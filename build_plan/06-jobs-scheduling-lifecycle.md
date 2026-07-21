# 06 — Jobs, Scheduling & Lifecycle

This file defines job states, transitions, and the semantics of delays, retries/backoff, priority, idempotency/singleton, recurring (cron/every) jobs, multi-step jobs, retention, and dead-lettering. It builds on the data model (file 04) and public API (file 05).

## 06.1 `JobStatus` enum & transitions

`JobStatus` (exported, `UPPER_SNAKE_CASE` keys and values):

- `PENDING` — inserted, waiting to become due / be claimed.
- `ACTIVE` — claimed by an instance, handler running (has a `locked_until` deadline).
- `COMPLETED` — handler resolved.
- `FAILED` — handler threw and attempts are exhausted (terminal; may be `dead_letter`).
- `RETRY` — handler threw but attempts remain; scheduled to run again at `start_after`. (Kept as a distinct state so the dashboard can show "waiting to retry" vs "fresh".)
- `CANCELLED` — cancelled before running.
- `EXPIRED` — passed `expire_at` before starting.

**Derived (not stored) status:** `STALLED` — a row in `ACTIVE` whose `locked_until < now()`. Computed in reads; the reclaimer returns it to `PENDING`/`RETRY`.

**Transitions:**
```
PENDING ──claim──▶ ACTIVE ──ok──▶ COMPLETED
   ▲                  │
   │              throw, attempts left
   │                  ▼
   └───retry-due──── RETRY
                      │  throw, attempts exhausted
ACTIVE ──lock expired (stalled)──▶ reclaim ▶ PENDING/RETRY
ACTIVE/throw-exhausted ─────────────────────▶ FAILED (dead_letter?)
PENDING ──cancel──▶ CANCELLED
PENDING ──past expire_at──▶ EXPIRED
```

Every transition emits an event (file 08) and is performed by a single atomic driver call so concurrent instances can't corrupt state.

## 06.2 Delivery guarantee

**At-least-once.** A job runs at least once; under crash/stall it may run again (the visibility timeout reclaims it). Handlers should be **idempotent**. This is stated prominently in the docs, with `idempotencyKey`/`singletonKey` and multi-step `lastStepReturnValue` offered as the tools to make handlers safe. At-most-once is explicitly *not* offered because it can't be guaranteed with crash recovery.

## 06.3 Delays & availability

- `delay` / `startAfter` set `start_after` in the future. A job is claimable only when `start_after <= now()`.
- Delayed jobs are found by the same claim query (it already filters on `start_after`), plus the safety poll wakes the loop when the nearest future job becomes due (the subscriber computes the next wake time from `min(start_after)`).
- `expireIn`/`expire_at`: a job still `PENDING`/`RETRY` past its `expire_at` must be expired **before** it ever runs. Because the stalled-reclaimer only scans `ACTIVE` rows, expiry of *due-but-unstarted* jobs is a **separate sweep**: the driver exposes `expireDueJobs({ queue?, now })` (marks `PENDING`/`RETRY` rows with `expire_at <= now` as `EXPIRED`), owned by the **SchedulerService tick** (it already runs on an interval and is cluster-coordinated). Also, the claim query filters out rows past `expire_at` so a racing claim never runs an expired job. This closes the gap where neither the reclaimer nor the claim path owned expiry.

## 06.4 Retries & backoff

- On handler throw with attempts remaining: `retry_attempt++`, status → `RETRY`, `start_after = now + backoff(retry_attempt)`, the message captured into `failure_message`.
- **Non-retryable errors (Celery-style `dontAutoretryFor`, file 05):** before scheduling a `RETRY`, the execution path checks the thrown error against the worker's `dontAutoretryFor` list (`instanceof` a listed constructor, or `error.name` matches a listed string). On a match the job **skips remaining attempts** and transitions straight to `FAILED` (dead-lettered if configured) — auto-retry is bypassed even when `retry_attempt < retry_max_attempts`. The message is still captured into `failure_message`.
- `BackoffStrategy`:
  - `FIXED` — `retryDelay` each time.
  - `EXPONENTIAL` — `retryDelay * factor^(retry_attempt-1)`, capped at `maxDelay`, with optional `jitter` (full/equal jitter) to avoid thundering herds across instances.
- Attempts exhausted → `FAILED`. If the queue has a `deadLetterQueue`, the failed job is copied/moved there (a new job on that queue carrying the original payload + failure metadata) and/or marked `dead_letter=true`. Document exactly one behavior: **mark `dead_letter=true` and, if a DLQ is configured, also enqueue a job onto it** so both introspection and reprocessing work.

## 06.5 Priority

- Integer `priority`, higher runs sooner. The claim ordering is `priority DESC, start_after ASC` (backed by `ix_job_claim`).
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

- A multi-step worker is created with `steps` (an **ordered array** of `{ id: StepId; handler }`) instead of `handler`. Step ids are a **developer-defined `StepId` enum**, and the **array order is the canonical sequence** — `steps[0]` is the initial step and the order defines "what comes next." An array with explicit ids (not a map/object) is required so ordering is deterministic and never relies on object key order (raw plan: "multiple steps predefined at the start, use enums for steps").
- The job row carries `current_step` and `steps_history` — an **append-only, ordered log of every step run** (each entry: the `step` id, its `startedAt`/`completedAt`/`failedAt`, its `input`, and its `returnValue`); a repeated step appends another entry, so a step can appear multiple times (04.2). On each claim, the `StepMachineService` runs the handler for `current_step`; the **input handed to it** is the `input` on the latest `steps_history` entry for `current_step` (the value the prior step carried over).
- **Canonical step-handler signature:** `(job: Job<TData>, step: StepController) => Promise<StepOutcome>`. Transitions live on the **`step` controller argument** (not on `job`, and not by returning a bare object) — this is the single model used across files 05, 06, and 19. A step handler returns exactly one of the controller's outcomes (named options, no positional args):
  - `step.next(stepId?, { data })` — advance: mark the completing step's current entry (`returnValue = data`, `completedAt = now`) and **append** a new entry for the target step (`startedAt = now`, `input = data`). `stepId` may be **omitted to advance to the next step in declared order**, or given to jump explicitly. The job stays in the queue and is re-claimed for the next step (so each step is an independent, crash-safe unit of work — this is how it resumes).
  - `step.repeat({ data?, delayMs? })` — re-run the **same** step (raw plan: "allow repeating at a sudden step"), optionally after a delay; **appends a fresh run entry** for that step (multiple runs are all kept, in order).
  - `step.done(returnValue)` — finish the whole job (`COMPLETED`): mark the current step's entry `completedAt` and store `returnValue` in the job's `return_value`.
- Between steps, the transition (`advanceStep`) is atomic; if the instance crashes after step N completes but before step N+1 starts, the job simply resumes at N+1 on another instance using the persisted `steps_history`. **This is the resumability numeric progress lacks.**
- "Which steps completed / are all done" is derived from `steps_history` (the `step`s among entries with `completedAt`) compared against the worker's declared steps (the ordered `steps` array) — there is no separate `completed_steps` column or `total_steps` count.
- Calling step-only controls on a single-function worker (or vice-versa) throws a typed `UnsupportedForWorkerTypeError` — the method exists so it's discoverable (raw-plan rule).

### 06.8.1 Retrying a job — from start vs from the failed step

A finished/failed job can be requeued two ways (exposed programmatically via `queue.retry`, and in the dashboard and CLI — files 05/12/13), controlled by a `RetryMode`:
- **`FROM_FAILED_STEP`** (default) — resume at `current_step` using its already-persisted input (the last completed entry's `returnValue` in `steps_history`). Completed steps are **not** re-run; their side effects and returns are preserved.
- **`FROM_START`** — restart the whole job from the first step: `current_step` resets to the initial step and a fresh run begins (a new `steps_history` chain is built; the prior history may be retained for audit). Handlers must be idempotent (06.2), since earlier steps re-execute.

For a single-function job the two modes are identical (one step).

**Why there is no "start from an arbitrary step" selector.** Each step's input is the **return value carried over from the previous step** (`step.next(stepId, { data })`). If we let you jump straight to, say, step 3, step 3 would run with a **missing or stale input** — step 2 never produced its return in this run — and every earlier step's side effects would be **silently skipped**, breaking the business-logic invariants the pipeline assumes. The only two points where the input is well-defined are the **start** (input = the job `data`) and the **failed step** (its input was persisted when the prior step completed). So we deliberately expose exactly those two and not a free step picker.

## 06.9 Retention & cleanup

- `RetentionOptions`: `mode: RetentionMode` (`KEEP_FOREVER` (default) | `DELETE_AFTER`), `ttl?: Duration`, `statuses?: JobStatus[]` (which finished statuses the policy applies to — default `COMPLETED`; failed jobs often kept longer).
- **Default is keep-forever** (raw-plan requirement). Nothing is deleted unless the operator opts in.
- The **`RetentionService`** runs on an interval (cluster-coordinated like the scheduler), **hard-deleting** finished jobs older than `ttl` from the `job` table in **bounded batches** (so it never long-locks the table). `DELETE_AFTER` is the only cleanup mode — there is no archive table, so rows are removed outright rather than copied elsewhere. If an operator wants to keep finished jobs, they use `KEEP_FOREVER` (the default) and prune with their own external tooling/queries against `job`.
- Retention can be set at client, queue, or job level (job wins), so a single critical job can be retained even if the queue purges aggressively.

## 06.10 Instance attribution

Each run records `run_on_instance_id` + `run_on_instance_type` (file 04/07) so the dashboard can show "how many jobs each server/container ran." Resolved once per process by `InstanceIdentityService` (file 07).

## 06.11 Local final-check checklist

- [ ] All state transitions are single atomic driver calls; safe under N instances.
- [ ] At-least-once is documented; idempotency/singleton/step tools are offered to make handlers safe.
- [ ] Backoff supports fixed + exponential with jitter and a cap.
- [ ] `dontAutoretryFor` short-circuits retries: a matching thrown error fails the job immediately (no more attempts), dead-lettered if configured.
- [ ] Recurring definitions produce distinct jobs sharing `scheduleId`; production is exactly-once per tick across the cluster.
- [ ] Cron is timezone-aware (DST-correct) with no heavy date dependency.
- [ ] Multi-step resumes from persisted `steps_history` after a crash; `next`/`repeat`/`done` outcomes exist; repeating a step is supported.
- [ ] Manual retry supports **from-start** and **from-failed-step** (`RetryMode`); no arbitrary-step selector, with the rationale documented.
- [ ] Retention defaults to keep-forever; cleanup runs in bounded batches; job-level retention overrides.
- [ ] Dead-letter behavior is documented and consistent (`dead_letter` flag + optional DLQ enqueue).
