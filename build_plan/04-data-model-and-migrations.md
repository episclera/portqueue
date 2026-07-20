# 04 — Data Model & Migrations

Design goals (from the raw plan): **minimum number of tables**, keep as much as possible on the `job` row to **avoid joins** (many target engines join poorly or not at all), **avoid JSON columns we control** (typed columns instead), and allow **per-engine deviation** in physical layout as long as the logical model and public API stay identical.

## 04.1 Table set (logical)

Four tables. This is fewer than pg-boss (which also has archive/subscription/version) by folding archive into an optional strategy and keeping schedules and versioning minimal.

1. **`queue`** — one row per named queue: its definition + control flags.
2. **`job`** — the heart. One row per job across its whole lifecycle. Everything the hot path needs is here so claiming never joins.
3. **`schedule`** — recurring/cron definitions that *produce* jobs. Kept separate because it has a different lifecycle (it persists and spawns many jobs).
4. **`migration_state`** — a tiny bookkeeping table: current schema version + applied-migration log.

An **optional 5th** table, `job_archive`, exists **only if** the consumer enables the archive retention strategy (file 06). Default retention is "keep forever," so most deployments have four tables.

**`job_archive` shape (when enabled):** a **column-for-column mirror** of `job` (same columns, same types) plus `archived_at` (timestamptz). No indexes beyond `pk_job_archive` on `id` and `ix_job_archive_archived_at` (for pruning/queries) — it's cold storage, not a hot path. The `RetentionService` copies finished rows into it, then deletes them from `job` (file 06.9). The dashboard's "archived jobs" view reads from it read-only.

> Table names come from the `TableName` enum and are prefixed (`tablePrefix`, default `pq_`) and schema-qualified per `DriverContext`. Never a string literal.

## 04.2 `job` table (columns)

Typed columns; no JSON except the developer's opaque `data` (and `result`). Nullable unless noted.

**Identity & routing**
- `id` — UUID, primary key (`pk_job`). DB-generated where `DB_GENERATED_UUID`, else app-generated.
- `queue` — text, not null. Indexed. The queue name = job type.
- `state` — enum column (`job_state_enum` on engines with native enums; else a `CHAR/TEXT` + `CHECK` constraint). Not null. See `JobState` (file 06).
- `priority` — integer, not null, default 0. Higher = sooner.

**Payload (opaque, developer-owned)**
- `data` — the job payload. `JSONB` where `JSON_NATIVE`, else `TEXT` holding serialized JSON. This is the developer's data; being opaque, JSON here is intentional and unavoidable.
- `result` — optional handler output, same storage rule as `data`.
- `metadata` — optional small **opaque JSON** object for developer correlation/tracing values (`JobOptions.metadata`, file 05). This is the *one* sanctioned bookkeeping-JSON column beyond the payload, added deliberately because a fixed typed set can't cover arbitrary tracing keys; it is size-bounded and never used by the engine for querying/claiming (so the no-JSON-for-hot-path rule still holds). Same storage rule as `data`.

**Scheduling & timing**
- `created_at` — timestamptz, not null.
- `available_at` (a.k.a. scheduled/`start_after`) — timestamptz, not null. A job is *due* when `available_at <= now()`. Delayed jobs set this to the future.
- `started_at`, `completed_at` — timestamptz.
- `expire_at` — optional absolute deadline after which a job that hasn't run is expired.

**Claiming / visibility (hot path)**
- `locked_until` — timestamptz. While `state=ACTIVE`, the visibility deadline; a passed deadline means stalled.
- `locked_by_instance_id` — text; which instance holds it.
- `run_on_instance_id` — text; which instance actually ran it (attribution; may equal locked-by).
- `run_on_instance_type` — enum column `instance_type_enum` (`CONTAINER | BARE_METAL | UNKNOWN`) so the dashboard can attribute work by source (file 07).

**Retry & failure**
- `attempt` — integer, not null, default 0 (incremented each try).
- `max_attempts` — integer, not null (resolved from job/queue options).
- `last_error_message` — text; `last_error_stack` — text; `last_error_at` — timestamptz. (Typed columns, not a JSON error blob.)

**Idempotency & correlation**
- `idempotency_key` — text. Unique per `(queue, idempotency_key)` where not null (`uq_job_queue_idempotency`). Adding a duplicate returns the existing job instead of inserting.
- `schedule_id` — UUID/text, indexed; set on jobs produced by a `schedule` (the cron/repeat correlation id). Lets the dashboard group all runs of one recurring job.
- `singleton_key` — optional text used for "only one active job with this key at a time" throttling (pg-boss-style), enforced by a partial unique index over active states.

**Multi-step (file 06)**
- `step` — text/enum column; the current step id for multi-step jobs (null for single-step).
- `step_data` — payload carried between steps (same storage rule as `data`); this is how a step resumes from where it left off (our replacement for BullMQ progress).
- `total_steps` / `completed_steps` — small integers for display (optional, derived where possible).

**Dead-letter**
- `dead_letter` — boolean, not null default false. A terminally failed job (attempts exhausted) is marked here (or moved to the configured dead-letter queue name; see file 06).

**Optional captured logs**
- `log` — optional bounded TEXT column holding the last N `job.log()` lines, populated **only when `captureLogs` is enabled** (file 05). Off by default (minimal storage); when off it stays null and logs go only to the injected `Logger`. Append-capped to a max size so it can never grow unbounded.

**Indexes (guided by the claim query):**
- `ix_job_claim` on `(queue, state, priority DESC, available_at)` — the ordering the claim uses. This one index makes the hot path fast without joins.
- `ix_job_locked_until` on `(state, locked_until)` — stalled-job reclaim scan.
- `ix_job_schedule` on `(schedule_id)`.
- `uq_job_queue_idempotency` unique on `(queue, idempotency_key)` where `idempotency_key is not null`.
- Partial unique for `singleton_key` over active states where supported.

All constraint/index names are explicit (`pk_`, `fk_`, `uq_`, `ix_`, `ck_`, `<table>_<col>_enum`), per the naming convention in `project-structure` §4.

## 04.3 `queue` table

- `name` — text, primary key (`pk_queue`).
- `paused` — boolean, not null default false (workers read this: paused ⇒ still accept new jobs into `job`, but do not claim/handle — exactly the dashboard requirement).
- `accepting` — boolean, not null default true (optional finer control: refuse new jobs while draining).
- Default option columns (typed, not JSON): `default_priority`, `default_max_attempts`, `default_retry_delay_ms`, `default_retry_backoff` (enum), `retention_mode` (enum), `retention_ttl_ms`, `dead_letter_queue` (text), `rate_limit_max`, `rate_limit_duration_ms`. These are queue-level defaults; job-level options override at insert time (resolved by `option-resolver`, file 05).
- `created_at`, `updated_at`.

Storing defaults as typed columns (not a JSON blob) keeps them queryable and honors the no-JSON rule.

**Concurrency note:** `pq.queue(name)` lazily registers the queue via `ensureQueue`, which many instances may call at once on first use. It **must** be an idempotent `INSERT ... ON CONFLICT DO NOTHING`/`MERGE` (capability `UPSERT`) on the `name` primary key so concurrent first-uses don't error or thundering-herd — the first writer wins, the rest no-op.

## 04.4 `schedule` table

- `id` — UUID, primary key (`pk_schedule`). This id is the `schedule_id` stamped onto produced jobs.
- `key` — text; caller-supplied stable identifier, unique per `(queue, key)` (`uq_schedule_queue_key`) so re-registering the same recurring job updates rather than duplicates (idempotent scheduling; ties into the repeat/idempotency rule).
- `queue` — text, not null.
- `cron` — text (cron expression) OR `every_ms` — integer (fixed interval). Exactly one is set (`ck_schedule_mode`).
- `timezone` — text (IANA tz) for cron evaluation.
- `data` — payload template for produced jobs (opaque, same storage rule).
- `job_options` — **not JSON**: expand the small set of per-produced-job options into typed columns (`priority`, `max_attempts`, `retry_delay_ms`, …) mirroring `queue`. If the option set is large enough that typed columns become unwieldy, this is the one justified exception to consider — but default to typed columns and document the choice (file 15).
- `next_run_at` — timestamptz; when the scheduler should next materialize a job.
- `last_run_at` — timestamptz.
- `enabled` — boolean.

The scheduler (file 06) reads due schedules, inserts a concrete `job` (stamped with `schedule_id`), and advances `next_run_at`. **A cron job never reschedules itself in place** — it produces the next distinct job, which is why runs share `schedule_id` but have unique job ids.

## 04.5 `migration_state` table

- `version` — integer, current applied schema version.
- `applied_at` — timestamptz.
- `checksum` — text (guards against a migration file changing after being applied).
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

- [ ] Four logical tables (five only if archive retention enabled); justified if an engine deviates.
- [ ] The hot claim path touches only the `job` table via `ix_job_claim` — no joins.
- [ ] No JSON column except the developer-owned `data`/`result`/`step_data`; all bookkeeping is typed.
- [ ] Idempotency enforced by a real unique constraint, not app-side checking.
- [ ] Recurring jobs share `schedule_id`; each run is a distinct `job` row.
- [ ] All constraints/indexes have explicit names per convention.
- [ ] Migrations are ordered, checksum-guarded, race-safe across instances, and have AUTO/MANUAL/VALIDATE_ONLY modes.
- [ ] Instance attribution columns (`run_on_instance_id`, `run_on_instance_type`) exist for dashboard stats.
