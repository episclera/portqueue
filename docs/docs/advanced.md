---
id: advanced
title: Advanced
sidebar_label: Advanced
description: Extend PortQueue with a custom driver for any database engine — implement the Driver interface, declare capabilities, and validate with the conformance kit.
keywords: [portqueue, custom driver, drivers, database queue, job queue, node.js, typescript, api reference]
---

# Advanced

Lower-level extension points for when the built-in engines aren't enough. Today that means
teaching PortQueue about a **new database engine** by writing your own driver.

## Writing a custom driver

Any engine PortQueue doesn't ship first-party can be supported by implementing the
`Driver` interface and declaring which **capabilities** it supports. Core branches on
capabilities, so an honest capability set is all it needs — every correctness invariant
(name uniqueness, idempotency/singleton dedup, transactional enqueue) is enforced in core,
so your driver only has to emit the best SQL its engine can.

```ts
import type { Driver, DriverCapabilitySet, MigrationStep } from '@portqueue/core';
import { BaseDriver, capabilities, DriverCapability, DatabaseEngine } from '@portqueue/core';

class MyDriver extends BaseDriver implements Driver {
  readonly engine = DatabaseEngine.POSTGRESQL; // your engine
  readonly capabilities: DriverCapabilitySet = capabilities({
    [DriverCapability.SKIP_LOCKED]: false,   // no row-skip lock? claim atomically another way
    [DriverCapability.LISTEN_NOTIFY]: false, // no pub/sub? core polls
    [DriverCapability.RETURNING]: false,
  });
  readonly migrations: MigrationStep[] = /* authored alongside this driver */;

  // …every method below, per the Driver interface
}

const pq = new PortQueue({ driver: new MyDriver() });
```

### Extend `BaseDriver`

`BaseDriver` (exported from `@portqueue/core`) carries everything that is **not** SQL, so a driver is
only its statements:

- **Row → record mapping** — `mapJob`, `mapQueue`, `mapSchedule`, `mapInstance`, and the `JOB_COLUMNS`
  / `SCHEDULE_INSERT_COLUMNS` lists they pair with. A column added to the schema then appears in every
  engine's insert, rather than needing to be remembered five times.
- **Value conversion** — `toJson`/`fromJson`, `boolIn`/`boolOut`, `numOrNull`/`strOrNull`, `likePattern`,
  `emptyStatusCounts`, id generation.
- **Arithmetic and paging helpers** — `phList`, `chunkForBind` (so a batch insert never exceeds your
  engine's bound-parameter limit), the multi-instance affinity scan plan, and the claim sort order.

You supply the four things that genuinely are per-engine: `execute(sql, params, session?)`,
`transaction(fn)`, `ph(index)` (your placeholder style) and `window(page, params)` (your paging tail).
Every statement string stays in your file — `BaseDriver` contains none.

### The `Driver` interface

Every method with more than one argument takes a named-options object, and every
producing/mutating method accepts an optional `tx?: TransactionHandle` so core can run it inside a
caller's transaction. The interface groups its methods by concern:

**Read-only members**

- `readonly engine: DatabaseEngine`
- `readonly capabilities: DriverCapabilitySet`
- `readonly context: DriverContext` — resolved table prefix, schema, and pub/sub namespace.
- `readonly migrations: MigrationStep[]` — the ordered steps this driver ships.

**Identity & lifecycle**

- `connect(): Promise<void>`
- `disconnect(): Promise<void>`
- `probe(): Promise<DriverProbe>` — `{ serverVersion, verifiedCapabilities }`.

**Schema & migration**

- `getSchemaVersion(): Promise<number | null>` — the highest applied version, or `null` when the
  migration table does not exist yet. **Only that condition may read as `null`**: a dropped connection
  or a permissions error has to surface, because reading it as "never migrated" would start a full
  migration run against a database that may already be migrated.
- `applyMigration({ migration: MigrationStep }): Promise<void>` — run the step's statements **and**
  record its version, in one transaction **wherever the engine allows it**. PostgreSQL, PGLite and
  SQLite run DDL transactionally, so a crash between the two cannot leave an applied-but-unrecorded
  migration there. MySQL and Oracle commit each DDL statement implicitly and no transaction can span
  them: those drivers run the statements first and record the version after, so an interruption leaves
  the schema reading one version behind and the step is re-run on the next start. **Write every
  migration to be idempotent** (`IF NOT EXISTS`, `MERGE`, a guarded `CREATE INDEX`) — the runner reads
  the version back before attempting the next step, so a step that ran without being recorded is
  reported rather than carried forward, but only idempotent DDL survives the re-run.

  Concurrency follows the same shape: where the engine has a named lock (`pg_try_advisory_lock`,
  MySQL's `GET_LOCK`) one instance migrates and the rest wait. Where it does not — Oracle, SQLite,
  PGLite — every instance applies, which is safe for idempotent DDL. For a multi-instance Oracle
  deployment, run `portqueue migrate` once before starting workers.

**Producing**

- `insertJob({ job, tx? }): Promise<InsertedJobRow>`
- `insertJobs({ jobs, tx? }): Promise<InsertedJobRow[]>` — the dedup lookup and the insert share a
  transaction, and a batch carrying an `idempotencyKey` or `singletonKey` must first take a lock every
  other producer on that queue also takes (a row lock on the queue row, or the engine's own write lock
  where it has one). Without it two concurrent adds of the same key both see no row and both insert.
- `insertSchedule({ schedule, tx? }): Promise<ScheduleRow>`
- `findJobByIdempotencyKey({ queueName, idempotencyKey, tx? }): Promise<InsertedJobRow | null>`
- `findScheduleByIdempotencyKey({ queueName, idempotencyKey, tx? }): Promise<ScheduleRow | null>`
- `deleteSchedule({ scheduleId, tx? }): Promise<ScheduleRef | null>`
- `deleteSchedules({ scheduleIds, tx? }): Promise<ScheduleRef[]>` — one statement for the whole set.
- `setScheduleEnabled({ scheduleId, enabled, now, tx? }): Promise<ScheduleRef | null>` — arm/disarm without deleting.

Every mutating method returns a **ref** (`{ jobId, queueName }` / `{ scheduleId, queueName }`) rather
than a bare boolean, because the caller needs the queue name to emit its event and wake the right
worker — and reading it back afterwards would be a second round trip (or, on a single-connection
engine, a deadlock).

**Claiming & completing (hot path)**

- `claimJobs({ queueName, limit, lockDurationSeconds, now, instanceKey? }): Promise<JobRecord[]>` —
  every claimed row must also carry a **fresh `lock_token`**, returned on the record. That token is the
  fence below.
- `extendLock({ jobId, lockDurationSeconds, now, lockToken? }): Promise<boolean>` — false when the row
  is no longer this claim's to extend. A negative `lockDurationSeconds` releases the lock.
- `completeJob({ jobId, returnValue?, now, lockToken?, tx? }): Promise<boolean>`
- `retryJob({ jobId, nextRunAt, retryAttempt, lastError, now, lockToken? }): Promise<boolean>`
- `failJob({ jobId, lastError, now, lockToken? }): Promise<boolean>`

  The three settle methods must be **guarded on the claim** — `status = ACTIVE`, and the `lockToken`
  when one is given — and must report whether the row was actually settled. Status alone is not
  enough: a lapsed lock is reclaimed and the row claimed again, so it reads `ACTIVE` once more, and a
  handler from the first run that ignored its abort signal would otherwise write its outcome over the
  second run's. A `false` tells core the claim was lost, and it emits `LockLostError` on the `ERROR`
  event instead of reporting the job as finished.
- `reclaimStalledJobs({ queueName?, limit, now }): Promise<StalledJobRef[]>` — bounded, and returns
  refs rather than whole rows: the caller needs the id, the queue to wake, and who was holding the job.
- `expireDueJobs({ queueName?, limit, now }): Promise<JobRef[]>` — bounded the same way; the caller
  loops until a batch comes back short.
- `requeueJob({ jobId, now, tx? }): Promise<RequeuedJobRef | null>` — re-arm a job's own row (manual
  retry). Must **refuse an `ACTIVE` row** and return `null`: clearing a running job's lock would let a
  second worker claim it, so the same job would run twice concurrently. An unknown id is also `null`,
  never an error, so one stale id can't fail a batch.
- `requeueJobs({ jobIds, now, tx? }): Promise<RequeuedJobRef[]>` — the same guard, in one statement.

**Reading**

- `getJob({ jobId }): Promise<JobRecord | null>`
- `getJobs({ queueName?, statuses?, scheduleId?, processedOnInstanceKey?, search?, limit, offset }): Promise<JobRecord[]>` —
  always newest-first. `search` is a case-insensitive substring matched **in SQL** across the id,
  status, idempotency key, failure message and serialized payload, so a text query pages in the
  database rather than being filtered in the process.
- `countJobsByStatus({ queueName?, processedOnInstanceKey? }): Promise<Record<JobStatus, number>>`
- `countJobsByStatusPerQueue({ queueNames }): Promise<Record<string, Record<JobStatus, number>>>` — the same breakdown for many queues in **one** grouped query, so a list page costs one count query rather than one per row. `countJobsByStatusPerInstance({ instanceKeys })` is its per-instance twin.
- `countJobs(filter): Promise<number>` — total rows behind a `getJobs` filter (`search` included), ignoring paging.
- `listQueues({ search?, processingPaused?, limit?, offset? }?): Promise<QueueRow[]>` — called with no options it returns every queue, which is what core's own reads want; the paging fields exist for list UIs. `countQueues(filter?)` gives the matching total.
- `listSchedules({ queueName?, enabled?, search?, limit?, offset? }): Promise<ScheduleRow[]>`, with `countSchedules(filter)`.
- `getSchedule({ scheduleId }): Promise<ScheduleRow | null>`
- `getDueSchedules({ now, limit }): Promise<ScheduleRow[]>`
- `advanceSchedule({ scheduleId, nextRunAt, lastRunAt, fromNextRunAt }): Promise<boolean>` — guarded so one instance wins each tick.

**Job control**

- `cancelJob({ jobId, now, tx? }): Promise<JobRef | null>` — only a `PENDING`/`RETRY` row is cancellable.
- `cancelJobs({ jobIds, now, tx? }): Promise<JobRef[]>`
- `removeJob({ jobId, tx? }): Promise<JobRef | null>` — never removes an `ACTIVE` row.
- `removeJobs({ jobIds, tx? }): Promise<JobRef[]>` — same guard, one statement. Every by-id batch must
  chunk its ids so a single statement cannot exceed what the engine allows in an `IN (...)` list —
  `BaseDriver.chunkIds`/`overIdChunks` do this from `maxInListItems` and `maxBindParams`.
- `removeJobsByStatus({ queueName, statuses, tx? }): Promise<number>`

**Queue control**

- `setQueuePaused({ queueName, processingPaused?, acceptingPaused?, now, tx? }): Promise<QueueRow | null>` —
  returns the updated row so the caller refreshes its cached pause flags without a second read.
- `ensureQueue({ name, options?, now, tx? }): Promise<QueueRow>`
- `getQueueByName({ name }): Promise<QueueRow | null>`
- `deleteQueue({ name, tx? }): Promise<boolean>`

**Instance liveness & per-instance pause**

- `upsertInstance({ instanceKey, now, metrics? }): Promise<InstanceRow>` — must never touch the
  independently-controlled pause flag, and must return the resulting row: the caller reads
  `processingPaused` from it rather than issuing a follow-up read.
- `listInstances({ search?, processingPaused?, alive?, seenSince?, limit?, offset? }?): Promise<InstanceRow[]>` — `alive` compares `last_seen_at` against the `seenSince` cutoff the caller computed, so the driver never needs to know the liveness window. `countInstances(filter?)` gives the matching total.
- `getInstance({ instanceKey }): Promise<InstanceRow | null>`
- `setInstancePaused({ instanceKey, processingPaused, now }): Promise<void>`
- `deleteInstance({ instanceKey, tx? }): Promise<boolean>`

**Retention**

- `deleteFinishedJobs({ olderThan, limit }): Promise<number>` — no status list: which statuses a row
  may be deleted in is the **row's own** `retention_statuses`, resolved when the job was added, or
  `NULL` for every finished status.

**Pub/sub** (only meaningful with `LISTEN_NOTIFY`)

- `notify({ channel, payload }): Promise<void>`
- `subscribe({ channel, onNotification }): Promise<Subscription>`

**Transactions** (internal use only)

- `runInTransaction<T>({ fn }): Promise<T>` — core opens the transaction and hands your driver the `TransactionHandle`.

**Advisory lock** (optional — gated by `ADVISORY_LOCK`)

- `tryAdvisoryLock?({ key }): Promise<boolean>`
- `releaseAdvisoryLock?({ key }): Promise<void>`

`MigrationStep` is `{ version: number; statements(context): string[] }` — identified by its version
alone; there is deliberately no checksum, because nothing ever compared one.
`DriverProbe` is `{ serverVersion: string; verifiedCapabilities: DriverCapability[] }`;
`Subscription` is `{ unsubscribe(): Promise<void> }`. All are exported from `@portqueue/core`, along
with `JobRef`, `StalledJobRef`, `RequeuedJobRef` and `ScheduleRef`.

### Own your dialect and migrations

A driver is **standalone per engine**: it lives in its own folder, carries its own migrations
authored in its engine's dialect, and shares no query-building code with drivers for other
engines. Core calls intent-named methods (`upsert`, `getOrCreate`, …) and
your driver emits whatever its engine does best: native `INSERT … ON CONFLICT` on a capable
engine, a guarded `UPDATE … RETURNING`-then-`INSERT` on a sharded one, or a mutate-then-read
on an engine without `RETURNING`. All values are bound parameters; identifiers are
allowlist-validated and quoted; every operation runs in a transaction.

The one exception is a **flavour of an engine that is already supported** — a build that speaks the
same wire protocol and dialect rather than a different engine. `PgliteDriver` is exactly that
(PGLite is PostgreSQL compiled to WASM), so it `extends PostgresqlDriver`, inherits the whole SQL
surface, and overrides only what is genuinely its own: the connection mechanism, its capability set
(no LISTEN/NOTIFY, no advisory locks) and its migration array. `PGLITE_MIGRATIONS` stays PGLite's
own array — it just points at the PostgreSQL statement builders while the DDL is identical, so a
version can be swapped for a PGLite-specific one without touching PostgreSQL. If your engine merely
*resembles* another, duplicate instead: subclass only when the dialect is the same by construction.

### Declare capabilities honestly

Core branches on `DriverCapability`, never on driver identity. Build the set with
`capabilities({ ... })` — any flag you omit defaults to `false`. Each flag gates a behaviour:

- `LISTEN_NOTIFY` — cross-connection pub/sub. If `false`, core polls at `pollIntervalSeconds` instead
  of waking on `notify`.
- `SKIP_LOCKED` — claim rows without blocking on ones another worker already locked. If `false`,
  core uses a polling/locking fallback for `claimJobs`.
- `RETURNING` — `INSERT`/`UPDATE` can return the affected rows in one round-trip. If `false`, the
  driver mutates then reads the rows back in the same transaction.
- `TRANSACTIONS` — the engine supports real transactions. If `false`, the transaction wrapper
  is a no-op (statements still run, just not atomically).
- `ADVISORY_LOCK` — the engine offers advisory locks, enabling the optional
  `tryAdvisoryLock`/`releaseAdvisoryLock` methods for leader-only tasks.

Every flag is one core branches on. A flag nothing reads is a promise the library doesn't keep, so
there is no `JSON_NATIVE`, `BATCHED_READ` or `DB_GENERATED_UUID`: payloads are always serialized to
text and ids are always supplied by the tool.

Where a feature genuinely can't exist, the corresponding method still exists and throws a
typed `UnsupportedCapabilityError` telling the developer the right path.

### Schema identifiers

So a rename is a single edit and a typo is a compile error, drivers reference logical names via
exported enums instead of raw string literals at query sites (migration DDL is the one exception —
it keeps raw strings as a historical record). All are exported from `@portqueue/core`:

- `TableName` — `QUEUE`, `JOB`, `SCHEDULE`, `INSTANCE`, `MIGRATION`.
- `QueueColumn` — e.g. `NAME`, `PROCESSING_PAUSED`, `ACCEPTING_PAUSED`, `CREATED_AT`, `UPDATED_AT`.
- `JobColumn` — every job column, e.g. `ID`, `QUEUE_NAME`, `STATUS`, `PRIORITY`, `DATA`,
  `START_AFTER`, `LOCKED_UNTIL`, `IDEMPOTENCY_KEY`, `SINGLETON_KEY`, `SCHEDULE_ID`, …
- `ScheduleColumn` — e.g. `ID`, `QUEUE_NAME`, `CRON`, `EVERY_SECONDS`, `NEXT_RUN_AT`, `LAST_RUN_AT`,
  `ENABLED`, `IDEMPOTENCY_KEY`, …
- `InstanceColumn` — `INSTANCE_KEY`, `PROCESSING_PAUSED`, `CREATED_AT`, `UPDATED_AT`, `LAST_SEEN_AT`.
- `MigrationColumn` — `VERSION`, `CREATED_AT`, `UPDATED_AT`.

The `validateIdentifier` helper (also exported) allowlist-checks any user-influenced identifier
(`schema` / `tablePrefix`) before it reaches SQL.

`DriverContext.tableNames` gives you three name forms, and they are not interchangeable:
`qualified(table)` is what every query must use (`jobs.pq_job` when a `schema` was configured),
`bare(table)` is the unqualified `pq_job`, and `derived(table, suffix)` names an object the engine
files *inside* the table's own schema — an index or a constraint — which must therefore stay
unqualified.

### Validate with the conformance kit

The kit runs the full behavioral suite against your driver so you know it obeys the same
contract as the first-party ones.

```ts
import { runConformance } from '@portqueue/core/conformance';

runConformance({ name: 'my-engine', createDriver: () => new MyDriver() });
```

Beyond the happy path it pins the guards core actually depends on, which are the ones a custom driver
is most likely to get subtly wrong: `requeueJob`/`removeJob`/`cancelJob` refusing an `ACTIVE` row,
`expireDueJobs` and `deleteFinishedJobs` (including per-row `retention_statuses`), `advanceSchedule`'s
guarded claim, the `search` filter, and agreement between every list page and its `count*`.

The same kit validates the built-in drivers, so passing it means your engine behaves identically to
PostgreSQL/SQLite from app code's perspective. PGLite and SQLite run it in CI; MySQL and Oracle are
validated with it by hand against a real server.
