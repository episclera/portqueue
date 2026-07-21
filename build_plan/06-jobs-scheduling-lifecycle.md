# 06 — Jobs, Scheduling & Lifecycle

This file defines job states, transitions, and the semantics of delays, retries/backoff, priority, idempotency/singleton, recurring (cron/every) jobs, workflows (multi-step jobs), and retention. It builds on the data model (file 04) and public API (file 05).

## 06.1 `JobStatus` enum & transitions

`JobStatus` (exported, `UPPER_SNAKE_CASE` keys and values):

- `PENDING` — inserted, waiting to become due / be claimed.
- `ACTIVE` — claimed by an instance, handler running (has a `locked_until` deadline).
- `COMPLETED` — handler resolved.
- `FAILED` — handler threw and attempts are exhausted (terminal).
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
ACTIVE/throw-exhausted ─────────────────────▶ FAILED
PENDING ──cancel──▶ CANCELLED
PENDING ──past expire_at──▶ EXPIRED
```

Every transition emits an event (file 08) and is performed by a single atomic driver call so concurrent instances can't corrupt state.

## 06.2 Delivery guarantee

**At-least-once.** A job runs at least once; under crash/stall it may run again (the visibility timeout reclaims it). Handlers should be **idempotent**. This is stated prominently in the docs, with `idempotencyKey`/`singletonKey` and a workflow's per-step `data` (the input persisted when the prior step spawned it) offered as the tools to make handlers safe. At-most-once is explicitly *not* offered because it can't be guaranteed with crash recovery.

## 06.3 Delays & availability

- `delay` / `startAfter` set `start_after` in the future. A job is claimable only when `start_after <= now()`.
- Delayed jobs are found by the same claim query (it already filters on `start_after`), plus the safety poll wakes the loop when the nearest future job becomes due (the subscriber computes the next wake time from `min(start_after)`).
- `expireIn`/`expire_at`: a job still `PENDING`/`RETRY` past its `expire_at` must be expired **before** it ever runs. Because the stalled-reclaimer only scans `ACTIVE` rows, expiry of *due-but-unstarted* jobs is a **separate sweep**: the driver exposes `expireDueJobs({ queue?, now })` (marks `PENDING`/`RETRY` rows with `expire_at <= now` as `EXPIRED`), owned by the **SchedulerService tick** (it already runs on an interval and is cluster-coordinated). Also, the claim query filters out rows past `expire_at` so a racing claim never runs an expired job. This closes the gap where neither the reclaimer nor the claim path owned expiry.

## 06.4 Retries & backoff

- On handler throw with attempts remaining: `retry_attempt++`, status → `RETRY`, `start_after = now + backoff(retry_attempt)`, the message captured into `failure_message`.
- **Non-retryable errors (Celery-style `dontAutoretryFor`, file 05):** before scheduling a `RETRY`, the execution path checks the thrown error against the worker's `dontAutoretryFor` list (`instanceof` a listed constructor, or `error.name` matches a listed string). On a match the job **skips remaining attempts** and transitions straight to `FAILED` — auto-retry is bypassed even when `retry_attempt < retry_max_attempts`. The message is still captured into `failure_message`.
- `BackoffStrategy`:
  - `FIXED` — `retryDelay` each time.
  - `EXPONENTIAL` — `retryDelay * factor^(retry_attempt-1)`, capped at `maxDelay`, with optional `jitter` (full/equal jitter) to avoid thundering herds across instances.
- Attempts exhausted → `FAILED` (terminal). The `failure_message` (message + stack) is captured. Failed jobs stay in the `job` table — queryable in the dashboard/CLI by `status = FAILED` and re-runnable with `queue.retryJob` — so there is no separate dead-letter queue.

## 06.5 Priority

- Integer `priority`, higher runs sooner. The claim ordering is `priority DESC, start_after ASC` (backed by `ix_job_claim`).
- Priority is a per-job option (queue can default it). No separate priority queues — one table, ordered claim.

## 06.6 Idempotency & singleton

- **`idempotencyKey`** — unique per `(queue, idempotencyKey)`. `add` with a colliding key does **not** insert; it returns the existing job with `deduplicated: true`. Enforced by the DB unique constraint (file 04), not app logic, so it's race-safe across instances. This also underpins **idempotent scheduling** — a schedule `key` maps to the same guarantee for recurring definitions.
- **`singletonKey`** — at most one *active/pending* job with this key at a time (pg-boss "singleton" semantics). Enforced by a partial unique index over active states. Adding another while one is in flight is rejected/deduped (documented behavior: returns the in-flight job with `deduplicated: true`).
- Both are surfaced in `AddJobResult` (`deduplicated: true`), and `deduplicationReason` (`IDEMPOTENCY | SINGLETON`) tells the caller which guard fired.

## 06.7 Recurring jobs — cron & every

Design principle (from raw plan): **a recurring definition produces new distinct jobs; it never mutates one job in place.** All runs share the definition's `schedule_id`.

- `queue.addJob({ data, schedule: { key, cron | every, timezone?, startAt?, endAt? } })` upserts a `schedule` row (idempotent on `(queue, key)`) — scheduling is the `schedule` **option** on `addJob`, not a separate method (file 05.3). The top-level `data` + job options are the template for produced jobs. Unschedule with `queue.removeSchedule({ scheduleId })`.
- The **`SchedulerService`** (one logical runner across the cluster) periodically finds schedules whose `next_run_at <= now()`, and for each: inserts a concrete `job` stamped with `schedule_id`, then advances `next_run_at` using the cron/every calculation. Insert + advance happen in one transaction so a crash can't double-produce or skip.
- **Cluster coordination:** to avoid N instances each producing the same run, the scheduler tick claims due schedules with the same `SKIP LOCKED`/atomic-update mechanism as jobs (or holds an advisory lock where available). Producing is therefore exactly-once per scheduled tick even with many instances.
- **`every`** accepts ms or a duration string; **`cron`** accepts standard 5-field (and optional 6-field seconds) expressions.
- **Cron parser scope (committed here, not deferred):** implement a small internal, dependency-free parser supporting the 5-field standard (minute hour day-of-month month day-of-week), optional leading seconds field (6-field), ranges (`1-5`), lists (`1,3,5`), steps (`*/10`), and `*`. Advanced specials `L` / `#` / `W` / `?` are **out of scope for v1** and must throw a clear `INVALID_OPTIONS` error naming the unsupported token (documented). This bounds the parser so it stays fully testable (file 16).
- **Timezones:** cron `next_run_at` is computed in the schedule's IANA `timezone` (default UTC), correctly handling DST using `Intl`/`Temporal` (no `moment`/`luxon` runtime dep). Document that `every` is wall-clock-interval and unaffected by tz.
- **Missed-run / catch-up policy:** if the scheduler was down and a schedule's `next_run_at` is in the past (possibly for several firing times), it **fires once** and advances `next_run_at` to the next future slot — it does **not** backfill every missed occurrence (which would flood the queue after an outage). This is stated in the docs because it's a common production surprise; `every` schedules likewise fire once and resume from now.
- **Naming:** the raw plan floated `repeat_delay`/`repeat_id`/`cron_id`. Final decision: the public option is **`schedule`** with `cron`/`every`; the correlation id is **`scheduleId`** (covers both cron and interval). This reads cleaner than `repeat_delay` and unifies both modes. Documented as the "repeat/cron id."

## 06.8 Workflows — multi-step, resumable jobs (replaces progress)

The raw plan explicitly rejects BullMQ-style numeric progress because it can't resume. PortQueue models durable, resumable work as a **workflow**: an ordered set of steps where **each step is its own `job` row**. Completing a step atomically **spawns the next step's job**; the run resumes simply because the next step is a normal claimable job. There is no single job that carries all steps, no `current_step` pointer, and no `steps_history` log — the run's history *is* the set of `job` rows sharing a `workflow_id` (file 04.2).

**Defining a workflow (DX).** A workflow is declared once, as an **ordered array** of steps, each `{ key: StepKey; handler }` — a handler **for every step** (file 05):

- Step keys are a **developer-defined `StepKey` enum**, and the **array order is the canonical sequence** — `steps[0]` is the **entry step** (where a run starts and where `FROM_START` resets to) and the order defines "what comes next." An array with explicit keys (not a map/object) is required so ordering is deterministic and never relies on object key order (raw plan: "multiple steps predefined at the start, use enums for steps"). Keys must be unique (validated when the definition is built).
- `defineWorkflow({ queue, steps })` (file 05) builds a **shared, pure `WorkflowDefinition`** — no I/O — that both the producer tier (`pq.createQueue(definition)`) and the worker tier (`pq.createWorker(definition)`) import from one module, so the step keys and their order are a single source of truth across the produce/consume split.

**Starting a run — same as adding a job.** A workflow queue differs from a simple queue in exactly one way: its worker has many `steps` instead of one `handler`. **Producing is identical** — `queue.addJob({ data })`. When the queue was obtained from its definition (`pq.createQueue(orderWorkflow)`), `add` enqueues the **first step's** job: the engine **mints a `workflow_id`**, stamps `workflow_step_key` with the definition's **entry step** (`steps[0].key`), and stores the payload as that step's `data`. `AddJobResult.workflowId` is returned. The producer never passes a step key (an optional `startStep` exists for the rare non-entry start, file 05.3).

**Running a step.** On each claim, the `WorkflowService` (file 02) dispatches to the handler whose key equals the job's `workflow_step_key`; the **input** is that job's `data` (the value the previous step carried over — or the original payload for the entry step). The handler signature is `(job: Job<TData>, step: StepController) => Promise<StepOutcome>`; transitions live on the **`step` controller argument** (not on `job`, not a bare return object) and every outcome is a **named-options** call (no positional args):

- `step.next({ to?, data? })` — advance. Marks this step's job `COMPLETED` (`return_value = data`) and **spawns a new `PENDING` job** for the next step in one atomic transaction (04.2 carry-over rules). `to` is **optional** — omitted, the next key is computed **programmatically** as the step after the current one in declared order; given, it jumps to that key. `data` becomes the next step's `data` (its input), or the current `data` is carried unchanged if omitted.
- `step.repeat({ data?, delayMs? })` — re-run the **same** step (raw plan: "allow repeating at a sudden step"): completes this job and spawns another job for the *same* `workflow_step_key`, optionally delayed (`start_after = now + delayMs`). Each run is its own row, so repeats/retries are all visible in order.
- `step.done({ result? })` — finish the whole run: mark this job `COMPLETED` with `return_value = result` and spawn **nothing**.

**Crash-safety / resumability.** The advance (complete-this + spawn-next) is a single atomic driver call (`advanceWorkflowStep`, file 03), so a crash can never complete-without-spawn or double-spawn. If a worker dies *mid-handler* — before that transaction — the step's own job is still `ACTIVE` and is reclaimed by the stalled-job reclaimer (06.1) and re-run: the run always resumes at the last un-advanced step, on **any** instance (the spawned job is `PENDING` and unlocked — 04.2). **This is the resumability numeric progress lacks.** Handlers must be idempotent (06.2), since a step may run more than once under crash recovery.

**Retry within a step.** Because each step is a normal job, the automatic backoff retry (06.4) applies **per step**: a throwing step retries against *its own* `retry_*` policy (re-resolved at spawn from the step/queue defaults, never inherited from the previous step). A step that exhausts its attempts transitions to `FAILED` — and because it never advanced, the run stops at that step (its failed job is where a manual retry resumes).

- Calling step-only controls on a single-function worker (or vice-versa) throws a typed `UnsupportedForWorkerTypeError` — the method exists so it's discoverable (raw-plan rule).

### 06.8.1 Retrying a workflow — from the failed step vs from start

A failed run can be requeued two ways (via `queue.retryJob`, and in the dashboard/CLI — files 05/12/13), controlled by a `RetryMode`:
- **`FROM_FAILED_STEP`** (default) — re-arm the failed step's own job (status → `PENDING`) so it runs again with its already-persisted `data`. Earlier steps — separate `COMPLETED` job rows — are **not** re-run; their side effects and returns are preserved.
- **`FROM_START`** — begin a **fresh run** from the entry step: enqueue a new first-step job under a **new `workflow_id`**, seeded from the original run's entry-step `data`. The failed run's rows are retained for audit (linked via `metadata`). Handlers must be idempotent (06.2), since earlier steps re-execute.

For a single-function job the two modes are identical (one step).

**Why there is no "start from an arbitrary step" selector.** Each step's input is the **`data` carried over from the previous step** (`step.next({ data })`). If we let you jump straight to, say, step 3, step 3 would run with a **missing or stale input** — step 2 never produced its output in this run — and every earlier step's side effects would be **silently skipped**, breaking the invariants the pipeline assumes. The only two points where the input is well-defined are the **entry step** (input = the original payload) and the **failed step** (its input was persisted when the prior step spawned it). So we deliberately expose exactly those two and not a free step picker.

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
- [ ] `dontAutoretryFor` short-circuits retries: a matching thrown error fails the job immediately (no more attempts).
- [ ] Recurring definitions produce distinct jobs sharing `scheduleId`; production is exactly-once per tick across the cluster.
- [ ] Cron is timezone-aware (DST-correct) with no heavy date dependency.
- [ ] Workflows: each step is its own `job` row sharing a `workflow_id`; completing a step spawns the next in one atomic transaction (`advanceWorkflowStep`); a mid-handler crash resumes at the un-advanced step on any instance; `next`/`repeat`/`done` outcomes exist; repeating a step is supported.
- [ ] Manual retry supports **from-start** and **from-failed-step** (`RetryMode`); no arbitrary-step selector, with the rationale documented.
- [ ] Retention defaults to keep-forever; cleanup runs in bounded batches; job-level retention overrides.
- [ ] Terminal failures land in `FAILED` (kept in `job`, queryable, manually retryable) — no dead-letter flag or queue.
