# `@portqueue/core` — review findings

A read-only audit of `packages/core/src` (93 files, ~14.5k LoC). Nothing here is implemented; each
item is a finding with enough detail to act on later.

Baseline at time of review: `npm test` → 15 suites / 160 tests pass. `npm run lint`
(`tsc --noEmit && eslint src`) → clean.

Findings are grouped by kind and ordered by severity inside each group.

---

## 1. Correctness — things that are wrong today

### 1.1 `createQueue` silently wipes a queue's registered options — and `pauseQueue`/`resumeQueue` trigger it

`port-queue.ts:148-163` destructures `{ name, ...queueOptions }` and calls
`registry.define(name, queueOptions)` **unconditionally**, before the "already have a handle" check.
`QueueRegistry.define` (`producer/queue-registry.ts:26-35`) *replaces* the stored options rather than
merging.

`pauseQueue` (`port-queue.ts:258`) and `resumeQueue` (`:263`) both call
`this.createQueue({ name: options.queue })` with no options, so `queueOptions` is `{}`:

```ts
const q = pq.createQueue({ name: 'email', defaultJobOptions: { retry: { maxAttempts: 5 } } });
await pq.pauseQueue({ queue: 'email' });   // define('email', {}) — defaults gone
await pq.resumeQueue({ queue: 'email' });
await q.addJob({ data });                  // retryMaxAttempts resolves to 1, not 5
```

Same for `retention`. Suggested fix: only `define()` when the caller actually passed options, or make
`define` merge; and have `pauseQueue`/`resumeQueue` go through the driver by name (as
`CliService`/`DashboardService` already deliberately do) instead of constructing a handle.

Related inconsistency in the same method: queue-scoped `hooks` are guarded by `hookedQueues` and
registered *once*, so a second `createQueue` with different hooks is ignored — while its options are
overwritten. Two adjacent lines with opposite semantics.

### 1.2 The Oracle driver emits SQL Oracle cannot parse

`drivers/oracle/oracle-driver.ts` is a near-verbatim copy of the Postgres driver (261 differing
lines out of ~1465) with only the placeholder style changed (`:1` instead of `$1`). The Postgres
dialect constructs it kept are not valid Oracle:

- `window()` (`:250-265`) emits `LIMIT ? OFFSET ?`. Oracle needs
  `OFFSET n ROWS FETCH NEXT n ROWS ONLY`. Also used at `:934` (`getJobs`), `:1114`
  (`getDueSchedules`), `:700`/`:729` (`claimJobs`), `:1407` (`deleteFinishedJobs`).
- Multi-row `UPDATE … RETURNING <cols>` producing a result set (`:700`, `:754`, `:826`, `:841`,
  `:1291`, `:1302`) — Oracle's `RETURNING` binds into OUT variables and does not return a row set
  from a multi-row DML.
- `INSERT … RETURNING *` (`:647`) — no `*` form in Oracle.
- CLOB columns (`data`, `return_value`, `failure_message` per `oracle/migrations.ts`) are read back
  as raw values with no `fetchInfo`/`outFormat` LOB handling — `oracledb` returns a Lob stream, not
  a string, unless configured. `mapJob`'s `fromJson` will not parse it.

Effectively the Oracle driver has never run against a server. Options: fix it properly against a
real instance, or mark it experimental / drop it from the published `exports` until it is verified.

### 1.3 `retryJob` / `requeueJob` re-arms a **running** job

`Queue.retryJob` (`producer/queue.ts:66`) documents "requeue a **failed or completed** job", but
`driver.requeueJob` has no status guard — the `UPDATE` is `WHERE id = ?` only
(`postgres-driver.ts:849-855` and the three copies). Requeueing an `ACTIVE` job flips it to
`PENDING` and clears `locked_until` while its handler is still running: the job gets claimed a
second time and runs concurrently with itself.

`removeJob`/`removeJobsByIds` both carefully guard `status != ACTIVE`; `requeueJob` should carry the
same guard (and return a "not re-armed" signal), or refuse `ACTIVE` at the `Queue` layer.

### 1.4 `runJobBatch` RETRY fails the whole batch on one missing id

`dashboard/dashboard.service.ts:364-368`. The docstring above the method promises "Ids that simply
didn't match (already gone, or an ACTIVE row a remove refuses) don't fail the batch". But
`requeueJob` throws `DriverQueryError` when the job is not found (`postgres-driver.ts:847`), and it
runs inside `runInTransaction`, so a single stale id rolls back every other retry in the batch.
Also `n += 1` is incremented unconditionally, so `affected` would over-report even if the throw were
caught.

### 1.5 `Queue.getJob` is not scoped to its queue

`producer/queue.ts:47-50`, under a `// --- Inspection (scoped to this queue) ---` banner, forwards
straight to `reads.getJob(jobId)` with no queue check. `queueA.getJob({ jobId: <job on queueB> })`
returns the other queue's job — and its `data` is typed as `queueA`'s `TData`. `getJobs` right below
it *does* inject `queue: this.name`. Compare `producer.getSchedule`, which explicitly returns `null`
for a schedule on another queue.

### 1.6 `RetentionOptions.statuses` is documented but ignored

`options/common.ts:33-34` declares `statuses?: JobStatus[]` with `(default: [COMPLETED])`.
`RetentionService.sweep` (`retention/retention.service.ts:21`) always passes `FINISHED_STATUSES`
(COMPLETED, FAILED, CANCELLED, EXPIRED). A caller who sets `retention: { mode: DELETE_AFTER,
ttlSeconds: 3600, statuses: [COMPLETED] }` also gets their failed jobs deleted — the opposite of
what they asked for, and the field never reaches `OptionResolver`. Either wire it through (it needs
to become a per-job column, since retention is resolved per job) or delete the field and the doc.

### 1.7 The `schema` driver option is validated and then ignored

`TableNames` (`drivers/table-names.ts:128-147`) validates and stores `schema`, but its only accessor
is `bare()`, which returns `${prefix}${table}` — no qualification. Every driver's `t()` calls `bare`.
So `new PostgresDriver({ schema: 'jobs' })` creates and queries `public.pq_job`, not `jobs.pq_job`,
with no error. Documented on Postgres (`:58`), PGLite (`:26`) and Oracle (`:58`).

Fix is either a `qualified()` accessor used at every query site, or removing the option from the
three driver option types and the docs.

### 1.8 Migrations are described as "checksum-guarded" but nothing compares checksums

`MigrationRunner`'s header says "ordered, checksum-guarded migrations"
(`drivers/shared/migration-runner.service.ts:12`). The `checksum` column is written
(`applyMigration`) and never read back. `getSchemaVersion` only reads `MAX(version)`. A v1 whose DDL
changed after being applied is undetectable — which matters precisely because the plan is to append
versions forever and freeze old ones.

Related: `applyMigration` runs the DDL in one transaction (via `toMigrationSteps` →
`runInTransaction`) and then records the version in a *separate* statement, so a crash between the
two leaves an applied-but-unrecorded migration. Survivable today only because every v1 statement is
`IF NOT EXISTS`.

### 1.9 `getSchemaVersion` swallows every error as "not migrated"

All four drivers wrap the read in `try { … } catch { return null }` with the comment "Table doesn't
exist yet" (e.g. `postgres-driver.ts:275-287`). A connection drop, a permissions error, or a typo'd
`tablePrefix` all read as version `null`, which under `MigrationMode.AUTO` starts a full migration
run and under `VALIDATE_ONLY` reports a misleading `SchemaVersionMismatchError(0, 1)`. Narrow the
catch to the engine's "relation does not exist" code, or probe for the table explicitly.

### 1.10 `Worker.stop`'s graceful drain busy-loops on a mismatched clock

`consumer/worker.ts:147-152` computes `deadline` from `runtime.clock.now()` and then sleeps on a real
`setTimeout(25)`. With an injected clock (`PortQueueOptions.clock`, `@internal` but public in the
type) the deadline never arrives and the loop spins for as long as handlers run. Use the real clock
for the timeout, or advance in units the injected clock understands.

---

## 2. Performance

### 2.1 No indexes anywhere — every claim is a full table scan

None of the five `migrations.ts` files creates a single index (verified: zero `INDEX`/`PRIMARY KEY`/
`UNIQUE` occurrences). Meanwhile the hot path runs, per worker, per poll:

```sql
… WHERE queue_name = ? AND status IN ('PENDING','RETRY') AND start_after <= ?
      AND (expire_at IS NULL OR expire_at > ?)
  ORDER BY priority DESC, start_after ASC LIMIT ?
```

That is a seq scan + sort of the whole `pq_job` table — including every COMPLETED row still under
retention. The same is true of `expireDueJobs`, `reclaimStalledJobs`, `deleteFinishedJobs`,
`findJobByIdempotencyKey`, `getJobs`' `ORDER BY created_at DESC`, and
`getDueSchedules`' `next_run_at`.

CLAUDE.md's driver invariant explicitly permits this: *"a capable engine (Postgres/PGLite) may use
native `INSERT … ON CONFLICT`/`MERGE`, **real indexes**, unique/check constraints and PKs"*. So this
is allowed and is almost certainly the single largest available win. Candidate set for
Postgres/PGLite/SQLite/MySQL (each authored in its own `migrations.ts` as a `version: 2`, never
editing `v1`):

| Index | Serves |
| --- | --- |
| `(queue_name, status, priority DESC, start_after)` on `job` | the claim query |
| `(status, locked_until)` on `job` | `reclaimStalledJobs` |
| `(status, expire_at)` on `job` | `expireDueJobs` |
| `(queue_name, idempotency_key)` on `job` | idempotency dedup |
| `(queue_name, singleton_key, status)` on `job` | singleton dedup |
| `(created_at DESC)` on `job` | `getJobs` paging |
| `(enabled, next_run_at)` on `schedule` | `getDueSchedules` |
| `(name)` on `queue`, `(instance_key)` on `instance` | every by-key read |

A sharded/distributed engine that can't honour them declares shard keys instead, exactly as the
invariant describes.

### 2.2 The claim loop issues an extra `SELECT` per iteration

`consumer/worker.ts:98` calls `await this.runtime.registry.refresh(this.config.queue)` inside the
`while` loop, and `refresh` is an unconditional `getQueueByName` round trip
(`queue-registry.ts:70-75`). With `pollIntervalSeconds: 5` and N workers that is a pause-flag query
every 5 s per worker, plus one per wakeup, plus one per freed concurrency slot — often more queue
reads than job claims. Options: cache with a short TTL, refresh on the maintenance tick instead, or
piggyback the flag on `claimJobs` (which already filters by `queue_name`).

### 2.3 The instance heartbeat does two round trips where one would do

`client/instance.service.ts:54-67` calls `upsertInstance` — which already `RETURNING *`s the full
row including `processing_paused` (`postgres-driver.ts:1280`, `:1291`) — and then immediately calls
`getInstance` for the same key just to read that flag. Drop the second query and read
`row.processingPaused` from the upsert result. Runs every 15 s per instance by default.

### 2.4 `expireDueJobs` / `reclaimStalledJobs` are unbounded across every queue

`SchedulerService.expireDue`/`reclaimStalled` (`scheduling/scheduler.service.ts:99-118`) call the
driver with no `queueName` and no limit. The driver does one `UPDATE … RETURNING <all 33 columns>`
over the whole table and core then materialises every row and emits an event per row. A backlog of
100k expired jobs turns one maintenance tick into a 100k-row transfer and 100k synchronous event
emissions. `deleteFinishedJobs` already takes a `limit` and `RetentionService` already batches —
these two should do the same (`limit` + loop until short batch), and should return ids rather than
whole records, since only `id` and `queueName` are used.

### 2.5 Rate-limited workers wait for the poll timer instead of the token

`consumer/worker.ts:104-108`: when `limiter.take(want)` returns 0 the pump `break`s and nothing
reschedules it — the next attempt is the `pollIntervalSeconds` timer (default 5 s) or an unrelated
wakeup. `RateLimiterService.msUntilAvailable()` (`monitoring/rate-limiter.service.ts:45`) exists
precisely for this and is **never called anywhere**. Scheduling a one-shot timer for
`msUntilAvailable()` would turn a 5 s stall into a sub-second one.

### 2.6 `insertJobs` is a loop over `insertJob` in every driver

`driver.interface.ts:107` promises a batch insert; all four implementations
(`postgres-driver.ts:575-584` and copies) just `for … await insertJob`. That is N round trips —
and N *extra* round trips when dedup keys are set, since each `insertJob` does its own pre-insert
lookup. Postgres/PGLite/MySQL/SQLite all support multi-row `VALUES`, and the dedup lookup could be
one `WHERE (queue_name, idempotency_key) IN (…)`.

Note that **nothing in core calls `insertJobs`** — see §4.1. Either wire up a public bulk-add
(a natural `Queue.addJobs`) and make it a real batch, or remove the method from the contract.

### 2.7 `removeSchedules` reads N schedules one at a time

`dashboard/dashboard.service.ts:417-419` does `Promise.all(scheduleIds.map(getSchedule))` purely to
learn each schedule's queue name for the event payload, then deletes them one-by-one inside the
transaction. A `listSchedules`-style `WHERE id IN (…)` read plus a single `DELETE … WHERE id IN (…)`
would be 2 queries instead of 2N.

### 2.8 Per-job allocation on the event and hook paths

- `EventBusService.emit` (`events/event-bus.service.ts:69`) copies the registration Set on every
  emit (`for (const reg of [...set])`) to make `once` removal safe. Four to six events fire per job.
  The copy is only needed when the set actually contains a `once` registration — track that with a
  counter and iterate directly otherwise.
- `HookRunner.forPhase` (`events/hook-runner.ts:35-39`) `filter`s the whole hook array on every
  call, four times per job, even when no hooks are registered. Index hooks by phase at
  registration time and early-return on an empty bucket.

### 2.9 Dashboard free-text job search scans the whole table in JS

`dashboard/dashboard.service.ts:283-324`. Chunked at 1000 rows, so memory is bounded, but the query
count is O(rows / 1000) and the whole payload of every job crosses the wire and is JSON-parsed
per row (`mapJob` → `fromJson`). The trade-off is deliberate and well documented; worth revisiting
once indexes exist — Postgres `pg_trgm` on `id`/`failure_message`, or pushing the `LIKE` into SQL for
the three text columns and keeping the JS pass only for the payload.

Related: `getQueues` with an `inUse` filter (`:97-105`) calls `listQueues(filter)` with **no page
window** and slices in memory. Bounded by queue count rather than job count, so much smaller, but
still the one unbounded read left in the facade.

### 2.10 `mapUnique` dedupes after paging

`listQueues`/`listInstances` apply `LIMIT/OFFSET` in SQL and then dedupe by name in JS
(`postgres-driver.ts:1030`, `:1335`). If a creation race ever produced a duplicate row, that page
comes back one item short while `countQueues` still counts both — so `items.length < limit` while
`total` says otherwise, and one row of the next page is skipped. Adding the unique index from §2.1
makes the whole `mapUnique` mechanism unnecessary on capable engines.

---

## 3. Invariant drift (CLAUDE.md rules the code no longer follows)

### 3.1 "Everything runs in a transaction" — the insert path doesn't

`insertJob` with no caller `tx` runs its dedup `SELECT` and its `INSERT` as two bare statements
(`runMaybeTx` → `execute`, `postgres-driver.ts:471-506`). Same for the SQLite/no-`SKIP_LOCKED` claim
branch (`:695`, `await build()` outside `this.transaction`). The stated invariant is: *"Every DB
operation the tool performs uses a transaction: the client-supplied `tx` when provided, otherwise
the driver's own. Even a single statement is wrapped."* Wrapping the dedup-plus-insert pair would
also narrow the "best-effort" dedup race the comment acknowledges at `:485-486`.

### 3.2 "`util/seconds.ts` is the one place seconds meet milliseconds" — there are ~15 others

`* 1000` appears inline in: `port-queue.ts:331`, `consumer/worker.ts:69,113,147`,
`consumer/execution.service.ts:94`, `client/client-lifecycle.service.ts:62,79`,
`client/instance.service.ts:38`, `monitoring/system-monitor.service.ts:108`,
`monitoring/stats.service.ts:118,144`, `dashboard/dashboard.service.ts:206`,
`scheduling/scheduler.service.ts:66,95`, plus `lockDurationSeconds * 1000` in all four drivers'
`claimJobs`/`extendLock`. The seconds-only *API* invariant holds everywhere — this is only about the
conversion being centralised. A `secondsToMs()` sibling to `wholeSecondsToMs()` (fractional-tolerant,
for the loop cadences the invariant explicitly exempts) would let all of these route through the one
boundary.

### 3.3 The default heartbeat window is duplicated in three places

`15` (heartbeat) and `× 3` (staleness) appear in `client-lifecycle.service.ts:87`,
`monitoring/stats.service.ts:118` and `:144`, and `dashboard/dashboard.service.ts:41`+`:204`. Four
independent copies of one policy; the dashboard's is at least named
(`DEFAULT_HEARTBEAT_SECONDS`). One exported constant + one `staleAfterMs(options)` helper.

### 3.4 `ReadService.getInstance`/`getInstances` and `DashboardService`'s versions are the same code twice

`monitoring/stats.service.ts:109-159` and `dashboard/dashboard.service.ts:139-197` build byte-identical
`InstanceInfo` objects with the same liveness maths. The dashboard version exists to add
search/paused/alive filters — it could call through to a `ReadService` mapper for the row → DTO half.
Same for the `emptyStatusCounts()` / `emptyCounts()` pair (`stats.service.ts:163`,
`dashboard.service.ts:471`) and the two more in the drivers, four identical copies of a 9-line
function.

### 3.5 Driver duplication is larger than the invariant needs

The duplicate-over-share rule is about **dialect and query SQL**, and rightly so. But each of the
four drivers also carries private copies of things with no dialect content at all:
`JOB_COLUMNS` (33 entries × 4), `mapJob`/`mapQueue`/`mapSchedule`/`mapInstance` (~120 lines × 4),
`toJson`/`fromJson`/`boolIn`/`boolOut`/`numOrNull`/`strOrNull`, `mapUnique`, `likePattern`,
`emptyStatusCounts`, `enabledCapabilities`, `jobInsertValues`, and the whole multi-instance affinity
paging loop in `claimJobs` (~35 lines, identical across Postgres/SQLite/Oracle, near-identical in
MySQL).

Those are row → record *mapping* and *mechanism*, not SQL — the same category as `TableName`, the
`MigrationRunner` and the value objects the invariant already puts in a shared spot. Lifting them to
`drivers/shared/` would cut roughly 400 duplicated lines per driver while leaving every statement
string exactly where it is. Worth a deliberate decision either way, since it reads as a genuine
tension with the letter of the rule.

### 3.6 The queue-column dedup enum is stale

`JobColumn.METADATA = 'metadata'` (`drivers/table-names.ts:36`) names a column that exists in no
migration and is referenced by no query. It will produce a runtime SQL error the first time someone
trusts the enum.

---

## 4. Dead / unreachable surface

Confirmed by grep across `packages/**` (excluding `dist`) — each of these has exactly one definition
site and zero call sites.

| Symbol | Location | Note |
| --- | --- | --- |
| `Queue._jobNotFound` | `producer/queue.ts:194` | private, never called; `JobNotFoundError` is never thrown anywhere |
| `RateLimiterService.msUntilAvailable` | `monitoring/rate-limiter.service.ts:45` | should be *used*, not deleted — see §2.5 |
| `QueueRegistry.cachedRow` | `producer/queue-registry.ts:77` | |
| `ClientLifecycleService.notifyCapable` | `client/client-lifecycle.service.ts:156` | |
| `BackgroundWork.inFlight` | `client/background-work.ts:26` | documented as diagnostics-only |
| `ACTIVE_STATUSES` | `jobs/job-state.enum.ts:27` | exported; the four drivers hard-code `('PENDING','ACTIVE','RETRY')` inline in singleton dedup instead |
| `STALLED` | `jobs/job-state.enum.ts:16` | exported const; `toSnapshot` computes a `stalled: boolean` instead |
| `ShutdownOptions.drain` | `options/client-options.ts:47` | declared, never read; `shutdown()` only forwards `graceful`/`timeoutSeconds` |
| `DriverCapability.JSON_NATIVE` | `drivers/driver-capabilities.ts:9` | no driver declares it, no code branches on it |
| `DriverCapability.BATCHED_READ` | `drivers/driver-capabilities.ts:10` | same |
| `DriverCapability.DB_GENERATED_UUID` | `drivers/driver-capabilities.ts:6` | only ever set (`false`, by Oracle); never read — every driver calls `uuid()` unconditionally |
| `Driver.ensureBaseObjects` | `driver.interface.ts:103` | all four implementations are `async () => {}`; called from `init()` and the conformance kit |
| `Driver.insertJobs` | `driver.interface.ts:107` | see §2.6 |
| `Queue.ensure()` | `producer/queue.ts:190` | only caller is a test |
| `NotStartedError` | `errors/errors.ts:38` | exported publicly, never thrown — no method actually guards on `isRunning` |
| `ShutdownTimeoutError` | `errors/errors.ts:151` | exported, never thrown; the timeout path logs a warning instead (`client-lifecycle.service.ts:147`) |
| `DriverContext.maxIdentifierLen` | `drivers/driver-context.ts:30` | plumbed only by Oracle; the default of 63 is a Postgres number |
| `JobColumn.METADATA` | `drivers/table-names.ts:36` | see §3.6 |

`NotStartedError` is the interesting one: producing or consuming before `init()` currently fails with
whatever the driver says ("Postgres driver is not connected"), not the clear message the error was
written for. Either throw it from the public entry points or drop it from the barrel.

---

## 5. Robustness / smaller notes

- **Unbounded module-global regex cache.** `jobs/instance-affinity.ts:15` — a process-lifetime `Map`
  keyed by pattern, shared across every `PortQueue` in the process. Patterns are developer-supplied
  so growth is bounded in practice, but it contradicts "DI per PortQueue instance" and would be
  cheap to cap (LRU) or move onto the runtime.
- **Scheduler due-batch is capped at 100 with no loop.** `scheduling/scheduler.service.ts:25` — with
  more than 100 schedules due in one tick the rest wait a full `tickIntervalSeconds`. Loop until a
  short batch, as `RetentionService.sweep` does.
- **`getSchedules` creates a queue row as a side effect of a read.** `producer.getSchedules`
  (`producer/producer.service.ts:342`) calls `registry.ensure(queue)` first, so listing schedules for
  a never-used queue name creates it.
- **`CliService.getSchedules` is unpaged.** `cli/cli.service.ts:57` calls `listSchedules` with no
  `limit`/`offset`, so `portqueue schedules` loads every schedule row. Every other list path clamps.
- **`MigrationRunner.waitForVersion` uses `Date.now()` directly** (`:92`) rather than the injected
  clock, and polls every 200 ms for 30 s. Real waiting in a codebase whose test story is "injectable
  clock, no real waiting".
- **`EventBusService.off` mutates the Set while iterating it** (`:44-46`). Safe under the JS
  iteration spec, but the `emit` path right below copies the Set for exactly this reason — the two
  read as inconsistent about the same hazard.
- **`toSnapshot` allocates ~12 `Date` objects per job row.** Fine for a detail view; measurable when
  the dashboard search maps 1000 rows a chunk purely to `.toLowerCase()` three string fields.
- **`errorToMessage` stores the full stack in `failure_message`** (`consumer/completion.service.ts:84`),
  an unbounded `TEXT` column, on every failure. A truncation cap would bound worst-case row size.

---

## 6. Testing

`npm test` is green (160 tests) and the conformance kit is a genuinely good design. Two gaps:

1. **Three of five drivers have zero automated coverage.** `jest.config.js` excludes
   `src/drivers/postgres/**` and `src/drivers/oracle/**` from coverage; MySQL isn't excluded but has
   no test either. Only PGLite and SQLite run. PGLite exercises the Postgres SQL by inheritance, so
   Postgres is largely covered in practice — but **MySQL and Oracle are entirely unverified**, which
   is how §1.2 survived. A `docker-compose` service per engine plus `runConformance(...)` behind an
   env guard would catch it; the kit already takes a driver factory, so it's wiring, not new tests.

2. **The conformance kit doesn't assert several contract points core relies on**: `expireDueJobs`
   and `deleteFinishedJobs` behaviour, `requeueJob`'s status semantics (§1.3), `cancelJob` refusing
   ACTIVE, `removeJob` refusing ACTIVE, `advanceSchedule`'s guarded-claim race, paging/`count*`
   agreement between a list and its total, and the `search` filters. Those are exactly the methods a
   custom driver is most likely to get subtly wrong.

---

## Suggested order of work

1. §1.1 (options wipe) and §1.3/§1.4 (requeue semantics) — small, user-visible correctness.
2. §2.1 (indexes as `version: 2`) — the big performance item; needs the migration-append pattern
   the schema was designed for.
3. §1.6, §1.7 (options that do nothing) — decide wire-up vs. removal, then sync `docs/`.
4. §2.3, §2.2, §2.4, §2.5 — round-trip and unbounded-scan reductions, each independent.
5. §6.1 (engine matrix in CI) before §1.2 (Oracle), so the fix is verifiable rather than hopeful.
6. §4 dead-surface sweep and §3.2/§3.3 consolidation — low risk, done last so nothing above
   conflicts with it.
