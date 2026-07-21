# 03 — Driver Model

The driver is the seam that makes PortQueue database-agnostic. **All SQL and all engine-specific behavior live behind the `Driver` interface.** Core services never branch on driver identity — they branch on **capabilities**. This is what lets a developer swap Postgres for SQLite without touching app code, and lets a third party add a new engine by implementing one interface.

> **Driver conformance — the no-join rule (file 04 §04.1).** No driver method may emit a relational `JOIN`, on any engine, hot path or cold. Relationships are followed with **separate, id-keyed single-table lookups** (e.g. resolving a job's queue is a second `SELECT ... WHERE id = :queue_id`, usually served from the per-instance cache), never a join — so every access path is portable to a future **NoSQL/document** driver that has no join. A driver whose engine can return several independent result sets in one round-trip *may* bundle those keyed `SELECT`s together (see `BATCHED_READ`) purely to save latency; that is a transport optimization, not a join. The conformance kit (file 11) asserts drivers never depend on cross-table joins.

## 03.1 Capabilities, not identity

A driver advertises what its engine supports via a capability set. Core code reads capabilities to choose a strategy; it never does `if (driver instanceof PostgresDriver)`.

`DriverCapability` enum (importable, no magic strings):

- `LISTEN_NOTIFY` — engine can push change notifications (Postgres `LISTEN/NOTIFY`, Oracle `DBMS_ALERT`/`CQN`). If absent, core uses interval polling.
- `SKIP_LOCKED` — engine supports `SELECT ... FOR UPDATE SKIP LOCKED` (Postgres, Oracle). If absent, core uses the documented atomic-claim fallback (03.5).
- `RETURNING` — `INSERT/UPDATE ... RETURNING` (Postgres, SQLite via `RETURNING`, PGLite). If absent, do insert+select in one transaction.
- `DB_GENERATED_UUID` — engine can generate the row UUID (`gen_random_uuid()`, `SYS_GUID()`). If absent, core generates UUIDs with `node:crypto`.
- `TRANSACTIONS` — supports the transactional-enqueue contract (file 09). All four first-party engines do.
- `ADVISORY_LOCK` — engine offers app-level locks (Postgres advisory locks) usable for leader-only tasks (e.g. single-runner scheduler election). Optional optimization.
- `JSON_NATIVE` — has a native JSON/JSONB column type for the payload; otherwise payload is stored as TEXT and (de)serialized by the driver.
- `UPSERT` — supports `INSERT ... ON CONFLICT` / `MERGE`, used for idempotency and schedule definitions.
- `BATCHED_READ` — engine can return **multiple independent result sets in one round-trip** (multi-statement query, batch, or pipeline). Optional optimization: when present, a driver may satisfy "fetch this job **and** its queue row" as two keyed `SELECT`s in a single round-trip instead of two; when absent, core just issues two calls (or reads the queue from cache). Never used to perform a join (no-join rule, §04.1).

The capability set is a typed, frozen object the driver returns. Core caches it after `connect()`.

## 03.2 The `Driver` interface (contract)

A driver is an injected class implementing this contract. Grouped by concern; every method that takes more than one argument takes a named-options object.

**Identity & lifecycle**
- `readonly engine: DatabaseEngine` — enum (`POSTGRES | PGLITE | SQLITE | ORACLE | CUSTOM`).
- `readonly capabilities: DriverCapabilitySet`.
- `connect(): Promise<void>` — open pool/handle.
- `disconnect(): Promise<void>` — close everything, including any dedicated LISTEN connection.
- `probe(): Promise<DriverProbe>` — returns server version + which capabilities were actually verified at runtime (so we can warn if a configured feature is unavailable).

**Schema & migration**
- `getSchemaVersion(): Promise<number | null>` — read `migration_state`.
- `applyMigration({ migration }): Promise<void>` — run one ordered migration step in a transaction.
- `ensureBaseObjects({ context }): Promise<void>` — create schema/prefix scaffolding if needed.

**Producing**
- `insertJob({ job, tx? }): Promise<InsertedJobRow>` — parameterized insert; honors `DB_GENERATED_UUID`/`RETURNING`/`UPSERT` per capabilities; when `tx` is supplied, runs on that transaction (file 09).
- `insertJobs({ jobs, tx? }): Promise<InsertedJobRow[]>` — bulk insert (single round-trip where the engine allows).
- `upsertSchedule({ schedule, tx? }): Promise<ScheduleRow>` — create/replace a recurring definition keyed by `schedule_id`.
- `deleteSchedule({ scheduleId, tx? }): Promise<boolean>`.

**Claiming & completing (the hot path)**
- `claimJobs({ queueId, limit, lockDurationMs, now, instanceId }): Promise<ClaimedJobRow[]>` — atomically claim up to `limit` due, visible jobs for a queue (ordered by priority then scheduled time), marking them active with a lock/visibility deadline and the claiming instance id. Uses `SKIP LOCKED` when available; otherwise the fallback in 03.5.
- `extendLock({ jobId, lockDurationMs, now }): Promise<boolean>` — heartbeat; returns false if the job was lost (reclaimed).
- `completeJob({ jobId, returnValue?, tx? }): Promise<void>`.
- `retryJob({ jobId, nextRunAt, retryAttempt, lastError }): Promise<void>` — reschedule for retry.
- `failJob({ jobId, lastError }): Promise<void>` — terminal failure (status → `FAILED`, `failure_message` captured).
- `advanceWorkflowStep({ jobId, returnValue, next?, tx? }): Promise<InsertedJobRow | null>` — the atomic workflow transition (file 06). In **one transaction**: mark `jobId` `COMPLETED` (`return_value`, `completed_at`), and — unless `next` is omitted (`step.done`) — **insert a new `PENDING` job** for the next step. `next = { workflowStepKey, data, startAfter }`; the inserted row carries over `workflow_id`, `queue_id`, `metadata`, `priority`, `schedule_id`, resolved retention, and instance attribution, and **resets** retry/lock/idempotency/timestamps (04.2). Returns the spawned row (or null for `done`). Atomicity guarantees no complete-without-spawn or double-spawn.
- `reclaimStalledJobs({ queueId?, now }): Promise<number>` — return jobs whose lock deadline passed to a claimable state.
- `expireDueJobs({ queueId?, now }): Promise<number>` — mark `PENDING`/`RETRY` jobs whose `expire_at <= now` as `EXPIRED` before they run (owned by the scheduler tick; file 06.3).
- `requeueJob({ jobId, from }): Promise<InsertedJobRow>` — **manual** retry of a finished/failed job (file 06.8.1). `from = FROM_FAILED_STEP` re-arms the failed step's own job (status → `PENDING`, retry counters reset) and returns it; `from = FROM_START` inserts a **fresh entry-step job under a new `workflow_id`**, seeded from the run's entry-step `data`, and returns it. (Distinct from `retryJob`, which is the automatic backoff retry.)

**Reading (dashboard/CLI/stats)**
- `getJob({ jobId }): Promise<JobRow | null>`.
- `getJobs({ queueId?, statuses?, limit, offset, order }): Promise<JobRow[]>`.
- `countJobsByStatus({ queueId? }): Promise<Record<JobStatus, number>>`.
- `listQueues(): Promise<QueueRow[]>`.
- `getThroughput({ queueId?, sinceMs }): Promise<ThroughputPoint[]>` — for dashboard graphs.

**Queue control**
- `setQueuePaused({ queueId, paused, tx? }): Promise<void>` — persisted pause flag read by workers.
- `ensureQueue({ name, options, tx? }): Promise<QueueRow>` — register (create-if-absent) a queue by **name**; returns the row including its `id`, which the core caches as `queue_id` for all subsequent job operations.

**Retention**
- `deleteFinishedJobs({ olderThan, statuses, limit }): Promise<number>` — the only retention primitive; hard-deletes finished rows from `job` in bounded batches. There is no archive table or archive method.

**Pub/sub (only meaningful when `LISTEN_NOTIFY`)**
- `notify({ channel, payload }): Promise<void>`.
- `subscribe({ channel, onNotification }): Promise<Subscription>` — resolves to something with an `unsubscribe()`.

**Transactions (file 09)**
- `runInTransaction<T>({ fn }): Promise<T>` — open a tx, pass a `TransactionHandle` to `fn`, commit/rollback. **Internal only** — used by core for PortQueue's *own* atomic sequences (claim, `advanceWorkflowStep`). It is **not** exposed as a public `pq.transaction` (dropped, file 09).
- The developer's transactional enqueue does **not** go through a driver `adoptTransaction`. Instead, an **adapter** (`fromKnex`, `fromPg`, … — file 09) wraps the caller's native transaction into a `TransactionHandle` that exposes "run this parameterized statement here"; the driver builds its engine-specific SQL and runs it via that handle when `insertJob({ tx })` is called. So there is **no `adoptTransaction` driver method** — the adapter is the seam.

Every method that an engine genuinely cannot implement must still exist and throw `UnsupportedCapabilityError` with the capability name and a documented workaround — but the design goal is that this is **rare**; capability-based fallbacks should keep the public behavior uniform.

## 03.3 `DriverContext` — schema & prefix

Constructed from client options and passed to the driver so all object names are computed once:
- `schema` — optional DB schema/namespace (Postgres/Oracle). SQLite/PGLite ignore or emulate.
- `tablePrefix` — prefix for all created tables (default e.g. `pq_`).
- Resolved fully-qualified names come from the `TableName` enum + prefix + schema. **Identifiers are validated against a strict allowlist pattern and quoted/escaped by the driver** — never string-concatenated from user input (file 18).

## 03.4 LISTEN/NOTIFY vs polling

- If `LISTEN_NOTIFY`: `SubscriberService` opens a dedicated listen connection and reacts to notifications with near-zero latency. Notifications carry only a lightweight signal (e.g. `{ queue }`), never the payload — the claim query is still the source of truth (notifications can be missed/coalesced).
- If not (SQLite, or a custom engine): `SubscriberService` runs an **adaptive poller** — a configurable base interval (`pollIntervalMs`) that backs off when idle and tightens when work is found. A "safety poll" also runs even when LISTEN is available, at a long interval, to catch missed notifications (delayed jobs becoming due, stalled reclaims). This guarantees correctness regardless of notification reliability.

## 03.5 Claiming under horizontal scale

The claim is the correctness-critical operation. Two strategies, chosen by capability:

- **`SKIP LOCKED` (Postgres, Oracle, and SQLite/PGLite where viable):** a single statement selects due rows `FOR UPDATE SKIP LOCKED LIMIT n`, and the same transaction marks them active with a lock deadline and instance id. Concurrent instances skip each other's locked rows — no contention, no double-claim.
- **Atomic-claim fallback (engines without `SKIP LOCKED`):** a conditional `UPDATE ... SET status=active, locked_until=..., instance_id=... WHERE id IN (SELECT ... due ORDER BY priority LIMIT n AND status=pending) RETURNING ...` (or update-then-select in one transaction when `RETURNING` is absent). Because the update is atomic and guarded by the current status, only one instance wins each row. SQLite's single-writer model actually makes this safe and simple.

In both cases the claimed rows get a **visibility deadline** (`locked_until`). A job whose deadline passes without completion is **stalled** and reclaimable by `reclaimStalledJobs` — this is how we survive instance crashes (Celery-style visibility timeout / late ack).

## 03.6 Custom drivers

Third parties implement the `Driver` interface and pass an instance to `new PortQueue({ driver })`. To make this pleasant:
- Ship an abstract **`BaseDriver`** with engine-neutral helpers (row↔Job mapping, migration bookkeeping, default retention SQL shape, capability-defaulting) so a custom SQL driver overrides only what differs.
- Export a **driver conformance test kit** from the `@portqueue/core/conformance` subpath (file 16): a suite a custom driver runs against a live connection to prove it upholds the contract (claim atomicity, visibility timeout, ordering, idempotency, transactional enqueue).
- Document the contract with the exact semantics each method must guarantee (ordering, atomicity, at-least-once vs at-most-once) in the docs (file 15).

## 03.7 Local final-check checklist

- [ ] Core never branches on driver identity — only on `DriverCapability`.
- [ ] Every method with >1 arg takes a named-options object.
- [ ] Claiming is atomic and safe under N instances for both `SKIP LOCKED` and fallback paths.
- [ ] Visibility timeout / stalled-reclaim exists so instance crashes never strand jobs.
- [ ] Notifications carry only signals, never payloads; a safety poll backstops missed notifications.
- [ ] Identifiers (schema/prefix/table) are allowlist-validated and quoted, never concatenated raw.
- [ ] `BaseDriver` + a conformance test kit exist so custom drivers are viable and verifiable.
