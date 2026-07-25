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
import type {
  Driver,
  DriverProbe,
  Subscription,
  MigrationStep,
  DriverCapabilitySet,
  DriverContext,
} from '@portqueue/core';
import { capabilities, DriverCapability, DatabaseEngine } from '@portqueue/core';

class MyDriver implements Driver {
  readonly engine = DatabaseEngine.POSTGRES; // your engine
  readonly capabilities: DriverCapabilitySet = capabilities({
    [DriverCapability.SKIP_LOCKED]: false,   // no row-skip lock? core uses a safe fallback
    [DriverCapability.LISTEN_NOTIFY]: false, // no pub/sub? core polls
    [DriverCapability.RETURNING]: false,
  });
  readonly context: DriverContext = /* built from your constructor options */;
  readonly migrations: MigrationStep[] = /* authored alongside this driver */;

  // …every method below, per the Driver interface
}

const pq = new PortQueue({ driver: new MyDriver() });
```

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

- `getSchemaVersion(): Promise<number | null>`
- `applyMigration({ migration: MigrationStep }): Promise<void>`
- `ensureBaseObjects(): Promise<void>`

**Producing**

- `insertJob({ job, tx? }): Promise<InsertedJobRow>`
- `insertJobs({ jobs, tx? }): Promise<InsertedJobRow[]>`
- `insertSchedule({ schedule, tx? }): Promise<ScheduleRow>`
- `findJobByIdempotencyKey({ queueName, idempotencyKey, tx? }): Promise<InsertedJobRow | null>`
- `findScheduleByIdempotencyKey({ queueName, idempotencyKey, tx? }): Promise<ScheduleRow | null>`
- `deleteSchedule({ scheduleId, tx? }): Promise<boolean>`

**Claiming & completing (hot path)**

- `claimJobs({ queueName, limit, lockDurationMs, now, instanceKey? }): Promise<JobRecord[]>`
- `extendLock({ jobId, lockDurationMs, now }): Promise<boolean>`
- `completeJob({ jobId, returnValue?, now, tx? }): Promise<void>`
- `retryJob({ jobId, nextRunAt, retryAttempt, lastError, now }): Promise<void>`
- `failJob({ jobId, lastError, now }): Promise<void>`
- `reclaimStalledJobs({ queueName?, now }): Promise<JobRecord[]>`
- `expireDueJobs({ queueName?, now }): Promise<JobRecord[]>`
- `requeueJob({ jobId, now, tx? }): Promise<InsertedJobRow>` — re-arm a job's own row (manual retry).

**Reading**

- `getJob({ jobId }): Promise<JobRecord | null>`
- `getJobs({ queueName?, statuses?, scheduleId?, processedOnInstanceKey?, limit, offset, order }): Promise<JobRecord[]>`
- `countJobsByStatus({ queueName?, processedOnInstanceKey? }): Promise<Record<JobStatus, number>>`
- `listQueues(): Promise<QueueRow[]>`
- `listSchedules({ queueName? }): Promise<ScheduleRow[]>`
- `getSchedule({ scheduleId }): Promise<ScheduleRow | null>`
- `getThroughput({ queueName?, sinceMs, now }): Promise<ThroughputPoint[]>`
- `getDueSchedules({ now, limit }): Promise<ScheduleRow[]>`
- `advanceSchedule({ scheduleId, nextRunAt, lastRunAt, fromNextRunAt }): Promise<boolean>` — guarded so one instance wins each tick.

**Job control**

- `cancelJob({ jobId, now, tx? }): Promise<boolean>`
- `removeJob({ jobId, tx? }): Promise<boolean>`
- `removeJobsByIds({ jobIds, queueName, tx? }): Promise<number>`
- `removeJobsByStatus({ queueName, statuses, tx? }): Promise<number>`

**Queue control**

- `setQueuePaused({ queueName, processingPaused?, acceptingPaused?, now, tx? }): Promise<void>`
- `ensureQueue({ name, options?, now, tx? }): Promise<QueueRow>`
- `getQueueByName({ name }): Promise<QueueRow | null>`
- `deleteQueue({ name, tx? }): Promise<boolean>`

**Instance liveness & per-instance pause**

- `upsertInstance({ instanceKey, now }): Promise<InstanceRow>`
- `listInstances(): Promise<InstanceRow[]>`
- `getInstance({ instanceKey }): Promise<InstanceRow | null>`
- `setInstancePaused({ instanceKey, processingPaused, now }): Promise<void>`
- `deleteInstance({ instanceKey, tx? }): Promise<boolean>`

**Retention**

- `deleteFinishedJobs({ olderThan, statuses, limit, now }): Promise<number>`

**Pub/sub** (only meaningful with `LISTEN_NOTIFY`)

- `notify({ channel, payload }): Promise<void>`
- `subscribe({ channel, onNotification }): Promise<Subscription>`

**Transactions** (internal use only)

- `runInTransaction<T>({ fn }): Promise<T>` — core opens the transaction and hands your driver the `TransactionHandle`.

**Advisory lock** (optional — gated by `ADVISORY_LOCK`)

- `tryAdvisoryLock?({ key }): Promise<boolean>`
- `releaseAdvisoryLock?({ key }): Promise<void>`

`MigrationStep` is `{ version: number; checksum: string; up(driver, context): Promise<void> }`;
`DriverProbe` is `{ serverVersion: string; verifiedCapabilities: DriverCapability[] }`;
`Subscription` is `{ unsubscribe(): Promise<void> }`. All are exported from `@portqueue/core`.

### Own your dialect and migrations

A driver is **fully standalone**: it lives in its own folder, carries its own migrations
authored in its engine's dialect, and shares no query-building code with other drivers —
even wire-compatible ones. Core calls intent-named methods (`upsert`, `getOrCreate`, …) and
your driver emits whatever its engine does best: native `INSERT … ON CONFLICT` on a capable
engine, a guarded `UPDATE … RETURNING`-then-`INSERT` on a sharded one, or a mutate-then-read
on an engine without `RETURNING`. All values are bound parameters; identifiers are
allowlist-validated and quoted; every operation runs in a transaction.

### Declare capabilities honestly

Core branches on `DriverCapability`, never on driver identity. Build the set with
`capabilities({ ... })` — any flag you omit defaults to `false`. Each flag gates a behaviour:

- `LISTEN_NOTIFY` — cross-connection pub/sub. If `false`, core polls at `pollIntervalMs` instead
  of waking on `notify`.
- `SKIP_LOCKED` — claim rows without blocking on ones another worker already locked. If `false`,
  core uses a polling/locking fallback for `claimJobs`.
- `RETURNING` — `INSERT`/`UPDATE` can return the affected row in one round-trip. If `false`, the
  driver mutates then reads the rows back in the same transaction.
- `DB_GENERATED_UUID` — the engine can generate job/schedule ids itself; otherwise core supplies them.
- `TRANSACTIONS` — the engine supports real transactions. If `false`, the transaction wrapper
  is a no-op (statements still run, just not atomically).
- `ADVISORY_LOCK` — the engine offers advisory locks, enabling the optional
  `tryAdvisoryLock`/`releaseAdvisoryLock` methods for leader-only tasks.
- `JSON_NATIVE` — the engine has a native JSON column type for payloads; otherwise core serializes
  to text.
- `BATCHED_READ` — the engine can efficiently read many rows in one round-trip.

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
- `ScheduleColumn` — e.g. `ID`, `QUEUE_NAME`, `CRON`, `EVERY_MS`, `NEXT_RUN_AT`, `LAST_RUN_AT`,
  `ENABLED`, `IDEMPOTENCY_KEY`, …
- `InstanceColumn` — `INSTANCE_KEY`, `PROCESSING_PAUSED`, `CREATED_AT`, `UPDATED_AT`, `LAST_SEEN_AT`.
- `MigrationColumn` — `VERSION`, `APPLIED_AT`, `CHECKSUM`, `CREATED_AT`, `UPDATED_AT`.

The `validateIdentifier` helper (also exported) allowlist-checks any user-influenced identifier
(`schema` / `tablePrefix`) before it reaches SQL.

### Validate with the conformance kit

The kit runs the full behavioral suite against your driver so you know it obeys the same
contract as the first-party ones.

```ts
import { runConformance } from '@portqueue/core/conformance';

await runConformance({ makeDriver: () => new MyDriver() });
```

The same kit validates the built-in drivers, so passing it means your engine behaves
identically to Postgres/SQLite from app code's perspective.
