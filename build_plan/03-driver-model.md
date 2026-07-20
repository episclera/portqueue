# 03 — Driver Model

The driver is the seam that makes PortQueue database-agnostic. **All SQL and all engine-specific behavior live behind the `Driver` interface.** Core services never branch on driver identity — they branch on **capabilities**. This is what lets a developer swap Postgres for SQLite without touching app code, and lets a third party add a new engine by implementing one interface.

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
- `claimJobs({ queue, limit, lockDurationMs, now, instanceId }): Promise<ClaimedJobRow[]>` — atomically claim up to `limit` due, visible jobs for a queue (ordered by priority then scheduled time), marking them active with a lock/visibility deadline and the claiming instance id. Uses `SKIP LOCKED` when available; otherwise the fallback in 03.5.
- `extendLock({ jobId, lockDurationMs, now }): Promise<boolean>` — heartbeat; returns false if the job was lost (reclaimed).
- `completeJob({ jobId, result?, tx? }): Promise<void>`.
- `retryJob({ jobId, nextRunAt, attempt, lastError }): Promise<void>` — reschedule for retry.
- `failJob({ jobId, lastError, deadLetter }): Promise<void>` — terminal failure (optionally into dead-letter state).
- `advanceStep({ jobId, nextStep, stepData, resetLock }): Promise<void>` — multi-step transition (file 06).
- `reclaimStalledJobs({ queue?, now }): Promise<number>` — return jobs whose lock deadline passed to a claimable state.
- `expireDueJobs({ queue?, now }): Promise<number>` — mark `CREATED`/`RETRY` jobs whose `expire_at <= now` as `EXPIRED` before they run (owned by the scheduler tick; file 06.3).

**Reading (dashboard/CLI/stats)**
- `getJob({ jobId }): Promise<JobRow | null>`.
- `getJobs({ queue?, states?, limit, offset, order }): Promise<JobRow[]>`.
- `countJobsByState({ queue? }): Promise<Record<JobState, number>>`.
- `listQueues(): Promise<QueueRow[]>`.
- `getThroughput({ queue?, sinceMs }): Promise<ThroughputPoint[]>` — for dashboard graphs.

**Queue control**
- `setQueuePaused({ queue, paused, tx? }): Promise<void>` — persisted pause flag read by workers.
- `ensureQueue({ queue, options, tx? }): Promise<QueueRow>` — register a queue definition.

**Retention**
- `deleteFinishedJobs({ olderThan, states, limit }): Promise<number>`.
- `archiveFinishedJobs({ olderThan, states, limit }): Promise<number>` — only if archive strategy is enabled.

**Pub/sub (only meaningful when `LISTEN_NOTIFY`)**
- `notify({ channel, payload }): Promise<void>`.
- `subscribe({ channel, onNotification }): Promise<Subscription>` — resolves to something with an `unsubscribe()`.

**Transactions (file 09)**
- `runInTransaction<T>({ fn }): Promise<T>` — open a tx, pass a `TransactionHandle` to `fn`, commit/rollback.
- `adoptTransaction({ external }): TransactionHandle` — wrap a developer-supplied native transaction/connection so `insertJob({ tx })` can run on it.

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
- **Atomic-claim fallback (engines without `SKIP LOCKED`):** a conditional `UPDATE ... SET state=active, locked_until=..., instance_id=... WHERE id IN (SELECT ... due ORDER BY priority LIMIT n AND state=created) RETURNING ...` (or update-then-select in one transaction when `RETURNING` is absent). Because the update is atomic and guarded by the current state, only one instance wins each row. SQLite's single-writer model actually makes this safe and simple.

In both cases the claimed rows get a **visibility deadline** (`locked_until`). A job whose deadline passes without completion is **stalled** and reclaimable by `reclaimStalledJobs` — this is how we survive instance crashes (Celery-style visibility timeout / late ack).

## 03.6 Custom drivers

Third parties implement the `Driver` interface and pass an instance to `new PortQueue({ driver })`. To make this pleasant:
- Ship an abstract **`BaseDriver`** with engine-neutral helpers (row↔Job mapping, migration bookkeeping, default retention SQL shape, capability-defaulting) so a custom SQL driver overrides only what differs.
- Export a **driver conformance test kit** from `@portqueue/testing` (file 16): a suite a custom driver runs against a live connection to prove it upholds the contract (claim atomicity, visibility timeout, ordering, idempotency, transactional enqueue).
- Document the contract with the exact semantics each method must guarantee (ordering, atomicity, at-least-once vs at-most-once) in the docs (file 15).

## 03.7 Local final-check checklist

- [ ] Core never branches on driver identity — only on `DriverCapability`.
- [ ] Every method with >1 arg takes a named-options object.
- [ ] Claiming is atomic and safe under N instances for both `SKIP LOCKED` and fallback paths.
- [ ] Visibility timeout / stalled-reclaim exists so instance crashes never strand jobs.
- [ ] Notifications carry only signals, never payloads; a safety poll backstops missed notifications.
- [ ] Identifiers (schema/prefix/table) are allowlist-validated and quoted, never concatenated raw.
- [ ] `BaseDriver` + a conformance test kit exist so custom drivers are viable and verifiable.
