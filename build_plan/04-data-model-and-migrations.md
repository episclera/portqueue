# 04 — Data Model & Migrations

Design goals (from the raw plan): **minimum number of tables**, keep as much as possible on the `job` row to **avoid joins** (many target engines join poorly or not at all), **avoid JSON columns we control** (typed columns instead), and allow **per-engine deviation** in physical layout as long as the logical model and public API stay identical.

> **Persistence rule (governs every table): store only what must be durable or shared across instances — never what can be read from the running `PortQueue` instance.** Configuration, defaults, and policy (the driver/connection, and `QueueOptions` like `defaultJobOptions`, `rateLimit`, `deadLetterQueue`, `retention`) live **in memory** on the instance — every process runs the same code or imports the same config module (file 13), and the app, dashboard, and CLI all read them from the live instance. A value earns a column only if it is one of: durable **work state** (the `job` row + its resolved options), a durable **definition the cluster must share** (`schedule`), **runtime control state an operator flips live** (`queue` pause flags), **engine bookkeeping** (`migration_state`, the rate-limit usage counter). If it's derivable from the instance, it does **not** get a column. Two consequences fall out of this: (a) config changes by editing code + redeploy (no DB update path), while runtime control state gets an explicit one (e.g. `pause()`/`resume()`); (b) split producer/worker deployments must construct their `PortQueue` from the same config (typically a shared config module).

## 04.1 Table set (logical)

Four tables. This is fewer than pg-boss (which also has archive/subscription/version) by dropping the archive table entirely (jobs live only in `job`) and keeping schedules and versioning minimal.

1. **`queue`** — one row per named queue: its definition + control flags.
2. **`job`** — the heart. One row per job across its whole lifecycle. Everything the hot path needs is here so claiming never joins.
3. **`schedule`** — recurring/cron definitions that *produce* jobs. Kept separate because it has a different lifecycle (it persists and spawns many jobs).
4. **`migration_state`** — a tiny bookkeeping table: current schema version + applied-migration log.

There is **no archive table**. `job` is the single, canonical home for every job across its whole lifecycle; finished jobs stay in `job` until retention hard-deletes them (file 06). Jobs are never copied to a second table.

> Table names come from the `TableName` enum and are prefixed (`tablePrefix`, default `pq_`) and schema-qualified per `DriverContext`. Never a string literal.

> **Timestamp convention:** every table carries `created_at` and `updated_at` (timestamptz, not null). `created_at` is set on insert; `updated_at` is bumped on every row mutation. Domain-specific timestamps (`started_at`, `completed_at`, `applied_at`, …) are in addition to, not instead of, these two.

## 04.2 `job` table (columns)

Typed columns; no JSON except the developer's opaque `data` (and `return_value`). Nullable unless noted.

**Identity & routing**
- `id` — UUID, primary key (`pk_job`). DB-generated where `DB_GENERATED_UUID`, else app-generated.
- `queue_id` — the owning queue's `id` (UUID), not null, indexed, FK `fk_job_queue` → `queue(id)` where the engine supports it. The hot claim path filters on this. (The public API still speaks queue **names**; a worker resolves its queue name → `queue_id` once via `ensureQueue` and caches it, so claiming stays single-table and join-free — see 04.3.)
- `status` — enum column (`job_status_enum` on engines with native enums; else a `CHAR/TEXT` + `CHECK` constraint). Not null. See `JobStatus` (file 06).
- `priority` — integer, not null, default 0. Higher = sooner.

**Payload (opaque, developer-owned)**
- `data` — the job payload. `JSONB` where `JSON_NATIVE`, else `TEXT` holding serialized JSON. This is the developer's data; being opaque, JSON here is intentional and unavoidable.
- `return_value` — optional handler/terminal-step output (the value the job returned), same storage rule as `data`.
- `metadata` — optional small **opaque JSON** object for developer correlation/tracing values (`JobOptions.metadata`, file 05). This is the *one* sanctioned bookkeeping-JSON column beyond the payload, added deliberately because a fixed typed set can't cover arbitrary tracing keys; it is size-bounded and never used by the engine for querying/claiming (so the no-JSON-for-hot-path rule still holds). Same storage rule as `data`.

**Scheduling & timing**
- `created_at` — timestamptz, not null.
- `updated_at` — timestamptz, not null; bumped on every mutation (claim, state change, step advance, retry reschedule). Powers the dashboard's "last activity" and lets you find recently-touched jobs.
- `start_after` — timestamptz, not null. A job is *due* when `start_after <= now()`. Delayed jobs set this to the future (also where a retry's backoff lands).
- `expire_at` — optional absolute **deadline** after which a job that hasn't run is expired. This is an *input*; distinct from `expired_at` below, which records when expiry actually happened.

**Lifecycle timestamps** — each records **when the job most recently entered that state**; all nullable, stamped by the transition that moves it there (`CompletionService` / reclaimer / scheduler, file 06.1). They give the dashboard an exact per-job timeline and feed retention/analytics:
- `started_at` — entered `ACTIVE` (claimed).
- `completed_at` — entered `COMPLETED`.
- `failed_at` — entered `FAILED` (attempts exhausted or a non-retryable error).
- `retried_at` — most recent transition into `RETRY` (distinct from `start_after`, which is *when* that retry becomes due).
- `stalled_at` — most recent time it was detected/reclaimed as stalled (lock expired while `ACTIVE`).
- `cancelled_at` — entered `CANCELLED`.
- `expired_at` — entered `EXPIRED` (when the `expire_at` deadline was enforced).

**Claiming / visibility (hot path)**
- `locked_until` — timestamptz. While `status=ACTIVE`, the visibility deadline; a passed deadline means stalled.
- `locked_by_instance_id` — text; which instance holds it.
- `run_on_instance_id` — text; which instance actually ran it (attribution; may equal locked-by).
- `run_on_instance_type` — enum column `instance_type_enum` (`CONTAINER | BARE_METAL | UNKNOWN`) so the dashboard can attribute work by source (file 07).

**Retry & failure**
- `retry_attempt` — integer, not null, default 0 (incremented each try).
- `retry_max_attempts` — integer, not null (resolved from job/queue options).
- `retry_delay_ms` — integer, not null. Base delay between retries (`retryDelay`, file 05), resolved from job/queue options.
- `retry_backoff` — enum column `backoff_strategy_enum` (`FIXED | EXPONENTIAL`), not null. The `BackoffStrategy` (file 06).
- `retry_backoff_factor` — real/numeric, nullable. Growth factor for `EXPONENTIAL` (`retryBackoff.factor`, default e.g. 2); ignored for `FIXED`.
- `retry_max_delay_ms` — integer, nullable. Cap on the computed delay (`retryBackoff.maxDelay`); null = uncapped.
- `retry_jitter` — boolean, not null default false. Whether to apply jitter to the computed delay (`retryBackoff.jitter`).
- `failure_message` — text; the failure message recorded when the job ends in `FAILED` (or the message from the latest failed attempt). It **includes the stack** — a JS `Error.stack` already begins with the message — so there is **no separate stack column**; and there is no error-timestamp column, since `failed_at` already records when it happened.

These backoff columns are **typed, not a JSON blob** — a column-for-column mirror of `BackoffOptions` (file 05) — so the `CompletionService` computes the next `start_after` on retry purely from the `job` row (no join to `queue` on the hot path). They're **resolved at insert** (job option overrides queue default, per `option-resolver`), consistent with `retry_max_attempts`; changing a queue default therefore never rewrites in-flight jobs.

**Retention (resolved at insert; file 06.9)**
- `retention_mode` — enum column `retention_mode_enum` (`KEEP_FOREVER | DELETE_AFTER`), not null. Resolved from job/queue/client options at insert.
- `retention_ttl_ms` — integer, nullable. How long after finishing before the `RetentionService` may delete this job; null for `KEEP_FOREVER`.

The `RetentionService` reads these **per-job** columns, so retention honors per-job overrides with no queue lookup — the same resolve-and-freeze pattern as retry. (This is why retention is not stored as a queue-level default column; see 04.3.)

**Idempotency & correlation**
- `idempotency_key` — text. Unique per `(queue_id, idempotency_key)` where not null (`uq_job_queue_idempotency`). Adding a duplicate returns the existing job instead of inserting.
- `schedule_id` — UUID/text, indexed; set on jobs produced by a `schedule` (the cron/repeat correlation id). Lets the dashboard group all runs of one recurring job.
- `singleton_key` — optional text used for "only one active job with this key at a time" throttling (pg-boss-style), enforced by a partial unique index over active states.

**Multi-step (file 06)**
- `current_step` — text/enum column; the current step id for multi-step jobs (null for single-step).
- `steps_history` — **JSON** column (JSONB where `JSON_NATIVE`, else serialized-JSON `TEXT`): an **append-only, ordered array**, one entry **per step run in the order it ran**. **Each entry mirrors the job's own column names** — a step run is described with the very same keys the `job` row uses, never ad-hoc ones: `{ step, data?, return_value?, started_at?, completed_at?, failed_at?, failure_message? }`. So a failed step records `failure_message` (the message, stack included — same as the job; there is **no** generic `error` key and no separate stack), a step's input is its `data` (matching `step.next({ data })`) and its output is `return_value`, exactly as at the job level. (`step` is the only extra key — the entry's discriminator.) A step that repeats appends **another** entry, so a step may appear multiple times — the array is the full run log in execution order. It is the single source for: the dashboard's per-step timeline, "which steps completed / are all done" (the set of `step`s among entries with `completed_at`, compared against the worker's declared steps), and crash-safe resume of `current_step` (its carried input is the `data` on the latest entry for `current_step`). Like `metadata`, it is a **sanctioned JSON column** — the step set is developer-defined and variable — and it is **never read on the claim/hot path** (only when a multi-step job is claimed for its next step, or for display/retry), so the no-JSON-for-querying rule still holds.

> **JSON key casing:** every key **we** put inside a JSON column (e.g. the `steps_history` entry fields) is **snake_case**, consistent with our column names; the driver/serializer maps them to the camelCase public types (e.g. `StepRun` in file 05). We **never** rewrite or re-case keys inside developer-owned JSON — the `data` payload, the `return_value`, and the `metadata` object are opaque and stored exactly as given.

**Dead-letter**
- `dead_letter` — boolean, not null default false. A terminally failed job (attempts exhausted) is marked here (or moved to the configured dead-letter queue name; see file 06).

**Indexes (guided by the claim query):**
- `ix_job_claim` on `(queue_id, status, priority DESC, start_after)` — the ordering the claim uses. This one index makes the hot path fast without joins.
- `ix_job_locked_until` on `(status, locked_until)` — stalled-job reclaim scan.
- `ix_job_schedule` on `(schedule_id)`.
- `uq_job_queue_idempotency` unique on `(queue_id, idempotency_key)` where `idempotency_key is not null`.
- Partial unique for `singleton_key`, scoped `(queue_id, singleton_key)`, over active states where supported.

All constraint/index names are explicit (`pk_`, `fk_`, `uq_`, `ix_`, `ck_`, `<table>_<col>_enum`), per the naming convention in `project-structure` §4.

## 04.3 `queue` table

- `id` — UUID, primary key (`pk_queue`). DB-generated where `DB_GENERATED_UUID`, else app-generated. This is the `queue_id` referenced by `job` and `schedule`.
- `name` — text, not null, unique (`uq_queue_name`). The human-facing queue name = job type; every public API call takes this **name** and the core resolves it to `id` (cached per instance).

**Queue's persisted state** — deliberately tiny; only what must survive across instances and be flipped at **runtime**:
- `processing_paused` — boolean, not null default false. When true, workers still accept new jobs into `job` but do **not** claim/handle them (the dashboard "stop handling" control; maps to `PauseMode.PROCESSING`). Renamed from `paused`.
- `accepting_paused` — boolean, not null default false. When true, the queue **refuses new jobs** (drain/incident control). Combined with `processing_paused` this is `PauseMode.ALL`. Renamed from `accepting` (polarity flipped so both pause flags read the same way and default false).
- `created_at`, `updated_at` — timestamptz, not null (`updated_at` bumped on every change to the row).

**Nothing else about a queue is persisted.** Its per-job defaults (priority, retry, retention) *and* its policy (`deadLetterQueue`, `rateLimit`) live **in-memory** on the `QueueOptions` passed to `pq.queue(name, options)`. Every instance runs the same code (or imports the same config module, file 13), so these values are identical everywhere without a DB copy: the `option-resolver` merges the defaults at `add()` time (client → queue → per-job) and freezes the **resolved** values onto each `job` row; the `CompletionService` reads `deadLetterQueue` on the instance handling the failure; the cluster rate limit reads its `max`/`duration` from the instance and shares only a **usage counter** in the DB (file 07.4). The dashboard and CLI read all of this off the live `PortQueue` instance.

Only the **pause flags** persist, because they're runtime *control state*: an operator flips them on a live system (dashboard/CLI/`pause()`), and instances that never called `pause()` must observe the change (file 07.2). Everything else is *config* — changed by editing code and redeploying, so it needs no DB update path; pause has an explicit one (`pause()`/`resume()`, an `UPDATE`).

**Concurrency note:** `pq.queue(name)` lazily registers the queue via `ensureQueue`, which many instances may call at once on first use. It **must** be an idempotent `INSERT ... ON CONFLICT DO NOTHING`/`MERGE` (capability `UPSERT`) on the unique `name` (`uq_queue_name`) so concurrent first-uses don't error or thundering-herd — the first writer wins, the rest no-op. `ensureQueue` **returns the row including its `id`**, which the instance caches as the `queue_id` used for all subsequent claims/inserts (so the name→id lookup happens once, not per operation).

## 04.4 `schedule` table

- `id` — UUID, primary key (`pk_schedule`). This id is the `schedule_id` stamped onto produced jobs.
- `key` — text; caller-supplied stable identifier, unique per `(queue_id, key)` (`uq_schedule_queue_key`) so re-registering the same recurring job updates rather than duplicates (idempotent scheduling; ties into the repeat/idempotency rule).
- `queue_id` — the owning queue's `id` (UUID), not null, FK `fk_schedule_queue` → `queue(id)`.
- `cron` — text (cron expression) OR `every_ms` — integer (fixed interval). Exactly one is set (`ck_schedule_mode`).
- `timezone` — text (IANA tz) for cron evaluation.
- `data` — payload template for produced jobs (opaque, same storage rule).
- `job_options` — **not JSON**: expand the small set of per-produced-job options into typed columns (`priority`, `retry_max_attempts`, `retry_delay_ms`, …) matching the resolved job columns. A schedule **does** persist its options (unlike a queue's in-memory defaults) because it materializes jobs later, on whichever instance runs the scheduler tick. If the option set is large enough that typed columns become unwieldy, this is the one justified exception to consider — but default to typed columns and document the choice (file 15).
- `next_run_at` — timestamptz; when the scheduler should next materialize a job.
- `last_run_at` — timestamptz.
- `enabled` — boolean.
- `created_at`, `updated_at` — timestamptz, not null (`updated_at` bumped whenever the definition or its run bookkeeping changes).

The scheduler (file 06) reads due schedules, inserts a concrete `job` (stamped with `schedule_id`), and advances `next_run_at`. **A cron job never reschedules itself in place** — it produces the next distinct job, which is why runs share `schedule_id` but have unique job ids.

## 04.5 `migration_state` table

- `version` — integer, current applied schema version.
- `applied_at` — timestamptz (the domain timestamp: when this migration was applied).
- `checksum` — text (guards against a migration file changing after being applied).
- `created_at`, `updated_at` — timestamptz, not null (present on every table for consistency; rows are effectively append-only, so `updated_at` normally equals `created_at`).
- One row per applied migration (a log), plus a way to read `max(version)`.

## 04.6 Per-engine deviation

The logical model is fixed; physical realization may differ:
- **Postgres/PGLite:** native `JSONB`, native enum types, `TIMESTAMPTZ`, `gen_random_uuid()`, `RETURNING`, `SKIP LOCKED`.
- **SQLite:** no enum type → `TEXT` + `CHECK`; timestamps as ISO-8601 `TEXT` or integer epoch ms (pick one, document it); JSON as `TEXT`; UUID app-generated; `RETURNING` supported in modern SQLite. Single-writer model simplifies claiming.
- **Oracle:** `SYS_GUID()`/UUID, `CLOB`/`JSON` type per version, `TIMESTAMP WITH TIME ZONE`, `SKIP LOCKED`, `MERGE` for upsert, `DBMS_ALERT`/CQN for notify.

Deviation in the number of physical tables is permitted **if an engine genuinely needs it**, but the four-table logical model is the target and any deviation must be justified in file 11.

## 04.7 Migration & versioning mechanism (auto-migrate)

`MigrationRunner` (in `schema/migration/`) owns schema evolution:

- Migrations are **ordered, numbered steps**, each expressed against the engine-neutral `SchemaDefinition` where possible, with per-engine SQL selected by capability where necessary.
- On `start()`, behavior is controlled by the client `migration` option:
  - `AUTO` (default) — apply all pending migrations up to the version this library ships.
  - `MANUAL` — do nothing; expose `portqueue migrate` (CLI) / a programmatic `pq.migrate()` for the operator to run.
  - `VALIDATE_ONLY` — verify the DB is at the expected version; throw a clear error (with the exact command to fix) if not. Good for prod where migrations run in a separate deploy step.
- Migrations run inside a transaction per step and are guarded by an **advisory lock (where available)** or a claim row so that N instances starting simultaneously don't race to migrate — only one applies; the others wait and then proceed.
- `checksum` detects a shipped migration being altered after it was applied (a bug/foot-gun) and fails loudly.
- **Version upgrades**: when the library adds columns/indexes, it ships a new numbered migration; upgrading the package + restarting (with `AUTO`) migrates forward. Downgrades are not auto-supported; document the manual path.

This satisfies the raw plan's "automatic mechanism that can migrate from a version to another."

## 04.8 Why so few tables (rationale to put in docs)

- Joins are avoided because several target engines join poorly and horizontal scale punishes cross-table contention.
- Keeping claim/lock/retry/step/error data on the `job` row means the hot claim query touches exactly one table and one index.
- Typed columns keep everything queryable by the dashboard/CLI and by operators writing ad-hoc SQL, and dodge the write-amplification and un-indexable nature of JSON blobs. The only JSON is the developer's own opaque payload.

## 04.9 Local final-check checklist

- [ ] Exactly four logical tables — `queue`, `job`, `schedule`, `migration_state`; no archive table. Justified if an engine deviates.
- [ ] **Persistence rule holds:** no column stores anything derivable from the running `PortQueue` instance (config/defaults/policy). Every column is durable work state, a shared definition, runtime control state, or engine bookkeeping.
- [ ] The hot claim path touches only the `job` table via `ix_job_claim` — no joins.
- [ ] No JSON column except the developer-owned `data`/`return_value`, the sanctioned `metadata`, and `steps_history`; all other bookkeeping is typed.
- [ ] Idempotency enforced by a real unique constraint, not app-side checking.
- [ ] Recurring jobs share `schedule_id`; each run is a distinct `job` row.
- [ ] All constraints/indexes have explicit names per convention.
- [ ] Migrations are ordered, checksum-guarded, race-safe across instances, and have AUTO/MANUAL/VALIDATE_ONLY modes.
- [ ] Instance attribution columns (`run_on_instance_id`, `run_on_instance_type`) exist for dashboard stats.
