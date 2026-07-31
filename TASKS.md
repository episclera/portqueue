# TASKS — audit findings

A review of `@portqueue/core`, `@portqueue/dashboard` and `@portqueue/cli` as of 2026-07-31
(branch `main`, commit `763038e`). Nothing here has been fixed — this is the backlog.

Baseline at the time of the audit: `npm test` → 17 suites, 165 tests, all passing.

Each item states the observed behaviour, why it matters, and where. Severity:

- **P1** — a correctness bug a user can hit, or a security gap.
- **P2** — a real defect with a narrower blast radius, or a guarantee the docs/comments claim
  that the code does not make.
- **P3** — an improvement: consistency, performance, ergonomics, test coverage.

---

## P1 — correctness and security

### 1. The dashboard's mutation endpoint has no CSRF defence, despite shipping the header for one

`packages/dashboard/src/shared/constants.ts` defines `REQUESTED_WITH_HEADER` /
`REQUESTED_WITH_MARKER` and documents them as "Header + marker the client sends on every request
**so the server can assert same-origin**". The client does send it
(`client/queries/api.ts:39`), but **no server code ever reads it** — grep for `REQUESTED_WITH`
across `packages/dashboard/src/server` returns nothing, and `routes/index.ts:handleAction`
dispatches on `action.kind` alone.

The mount is therefore open to cross-site request forgery: `POST /portqueue/api/actions` with
`content-type: text/plain` is a CORS-simple request, so any page a logged-in operator visits can
purge a queue, pause every instance, or enqueue jobs. `withCredentials: true` on the axios
instance means cookie-based auth in front of the mount does not help. The CLI's basic-auth guard
does not either — the browser replays basic credentials on a cross-site form post.

Fix: reject a mutation whose `x-requested-with` is not the marker (the header is already in
`HandlerInput.headers`), and/or require `content-type: application/json`, which forces a
preflight. Add a route test for a mutation missing the header.

### 2. `Worker.stop()` releases the lock of a job that is about to complete normally

`consumer/worker.ts:181-191` — after the drain window, `stop()` iterates
`this.execution.active` and, for **every** entry, aborts the controller *and* issues
`extendLock({ lockDurationSeconds: -1 })` to push the deadline into the past.

The abort is cooperative; a handler that ignores `job.signal` (the common case for short work)
keeps running and then calls `completeJob`. Meanwhile the lock is already released, so between
the release and the completion another instance's `reclaimStalledJobs` can return the row to
`PENDING` and a second worker can claim it. The job then runs twice, and the first run's
`completeJob` — which is **unguarded on status** in all four drivers (`completeJob` has only
`WHERE id = ?`, no `AND status = 'ACTIVE'`) — overwrites the second run's row.

Two independent fixes, both worth doing:

- Only release the lock for handlers that actually observed the abort, or release it after the
  execution promise settles rather than beside the abort.
- Guard `completeJob` / `failJob` / `retryJob` on `status = ACTIVE` (and on the lock still being
  held) in every driver, so a job whose claim was stolen cannot write over the new run's outcome.
  Add a conformance case: "a completion after the lock lapsed does not overwrite a re-claim".

### 3. `PortQueue.cancelJob` reports success without settling the row

`port-queue.ts:405-421`. When the job is running in this process, `cancelRunning()` fires the
`AbortSignal` and the method returns `true` immediately. If the handler ignores `job.signal` and
runs to completion, the job ends `COMPLETED` — the caller was told the cancel succeeded and no
row ever reached `CANCELLED`. The docstring hedges ("the handler must honour `job.signal` to
actually stop") but the boolean does not distinguish "cancelled" from "asked to stop".

Same shape in `dashboard.service.ts:runJobBatch` (CANCEL): locally-running ids are counted in
`affected` and a `JOB_CANCELLED` event is emitted for each, before anything has settled — so the
dashboard toast says "Cancelled 3 jobs" for jobs that may all complete normally.

Fix: either return a tri-state (`cancelled` / `signalled` / `not-found`), or await the settle and
report what the row actually became. At minimum, stop emitting `JOB_CANCELLED` for a job that has
only been signalled.

### 4. Batch id methods bypass `chunkForBind`, so a large batch exceeds the bind-parameter limit

`chunkForBind` is called in exactly one place per driver — `insertJobs`
(`postgres-driver.ts:316`, `sqlite:320`, `mysql:307`, `oracle:361`). Every other batch binds the
whole id list into one `IN (...)`:

- `removeJobs`, `cancelJobs`, `requeueJobs`, `deleteSchedules` (all four drivers)
- `countJobsByStatusPerQueue` / `countJobsByStatusPerInstance` via `countByStatusGrouped`
- `removeJobsByStatus` (bounded by the status count, so fine)

Oracle lowers `maxBindParams` to 4 000 (`oracle-driver.ts:135`) and Oracle's own hard `IN`-list
limit is 1 000 expressions — so `removeJobs` with 1 001 ids raises ORA-01795 on Oracle, and the
others fail past ~32 k on SQLite / 65 k on Postgres. Reachable from the dashboard's bulk selection
and from `pq.removeJobs({ jobIds })`.

CLAUDE.md's own rule says "Chunk by `BaseDriver.chunkForBind` so a statement can't exceed the
engine's bound-parameter limit" — this is that rule not being applied. Fix: chunk every id-list
method, and add a conformance case that pushes past a driver's limit.

### 5. `getQueue`/`getQueues` counts can disagree with the page on a large queue list

`stats.service.ts:155-172` runs `listQueues({limit, offset})` and `countQueues()` in
`Promise.all`, then a third `countJobsByStatusPerQueue`. Not a bug on its own, but
`countQueues()` here is called **with no filter** while `listQueues` is called with none either —
so this one is consistent. The real gap is the public `getQueues`: `GetQueuesQuery` is
`PageQuery` and nothing else, while `_dashboard.getQueues` supports `search` and
`processingPaused`. A developer using the public API to find paused queues has to page the whole
table and filter in process — exactly what the "filter, page and count in the database" invariant
forbids callers from having to do.

Fix: promote `search` / `processingPaused` onto `GetQueuesQuery` (the driver already supports
both via `QueueListFilter`), or document explicitly why they are dashboard-only.

---

## P2 — defects and unkept guarantees

### 6. `applyMigration` is **not** atomic on MySQL or Oracle

`postgres-driver.ts:263` and `sqlite-driver.ts` both wrap the DDL and the version insert in one
transaction, as the invariant in CLAUDE.md requires ("`applyMigration` runs the statements *and*
records the version in one transaction, so a crash between them can't leave an
applied-but-unrecorded migration").

`mysql-driver.ts` and `oracle-driver.ts` run the statements with a bare loop and then the version
insert — no transaction at all. On MySQL that is unavoidable for DDL (implicit commit per
statement), but Oracle behaves the same way, and neither file says so. As written, a crash between
the last DDL statement and the version insert leaves both engines in the state the invariant
claims is impossible: a schema that is applied but reads as version 0, so the next start re-runs
every statement (survivable only because `v1` is `IF NOT EXISTS`-guarded; a future `v2` with an
`ALTER` would not be).

Fix: either make the two engines record the version first-and-guarded, or amend the invariant and
the class docs to state the DDL-autocommit exception and what it costs — and make every future
migration idempotent by construction on those engines.

### 7. Migration lock is Postgres-only, so concurrent first-boot races on every other engine

`migration-runner.service.ts:63` takes the advisory lock only when
`capabilities[ADVISORY_LOCK]`, which is true for Postgres alone (PGLite overrides it to `false`,
MySQL and Oracle never declare it, SQLite has no such concept). On MySQL and Oracle, N instances
starting simultaneously against a fresh database all run the full DDL concurrently. `v1` is
`IF NOT EXISTS`-guarded so today it mostly survives, but Oracle's index creation is
PL/SQL-guarded on `ORA-00955` and MySQL's `CREATE SCHEMA` is not serialized — and nothing
verifies this.

Fix: give the runner a fallback mutual exclusion for capable-but-lockless engines (a guarded
insert into the migration table as a claim row, or a `SELECT … FOR UPDATE` on it), or state
plainly in the docs that a multi-instance MySQL/Oracle deployment must migrate with
`portqueue migrate` before starting workers.

### 8. `retryJob`'s `RETRY` status is not cleared by `requeueJobs`, and `stalled_at`/`retried_at` survive a requeue

`requeueJobs` (all four drivers) resets `retry_attempt`, `failed_at`, `failure_message`,
`completed_at`, `started_at`, `cancelled_at`, `expired_at`, `return_value`, `locked_until` — but
leaves `retried_at` and `stalled_at` set. The dashboard renders both
(`LifecycleTimeline.tsx:24-25`, `JobDetail.tsx:123-124`), so a requeued job shows a "Stalled" and
"Retried" marker from a previous life beside a `PENDING` status and a zeroed attempt counter.

The docstring on `PortQueue.retryJob` says the job's "retry counters, lock, return value and
timestamps [are] reset" — two of the timestamps are not.

Fix: null both columns in the four `requeueJobs` statements, and add a conformance assertion.

### 9. `insertJobs` dedup is a read-then-write with no uniqueness backstop

`findDeduplicated` + the multi-row insert share a transaction, and the comment says this "narrows
the dedup race to the width of a single statement pair". Under `READ COMMITTED` (Postgres/MySQL
default) two concurrent `addJob`s with the same `idempotencyKey` both see no row and both insert —
the dedup silently fails. The schema deliberately declares **no** unique index on
`(queue_name, idempotency_key)`, so nothing catches it.

This is a deliberate trade (CLAUDE.md: "idempotency and singleton dedup stay enforced in driver
code … so a dedup returns the existing job rather than surfacing as a constraint violation"), but
the guarantee callers read into "idempotencyKey" is stronger than what is delivered, and neither
the docs nor the conformance kit says "best-effort under concurrency".

Fix (pick one): document it as best-effort; or add a unique partial index on the capable engines
and catch the violation to return the existing row (behaviour stays identical, the race closes);
or take a per-key advisory lock where available. At minimum, add a conformance case that runs two
concurrent identical adds and asserts the documented outcome.

### 10. `pauseQueue` on an unknown queue throws only *after* a write attempt, and emits its event regardless of what happened

`port-queue.ts:530-536`: `pauseQueue` awaits `setPaused`, which throws `QueueNotFoundError` when
no row matched — good. But `resumeQueue` (line 539) and `pauseQueue` both emit
`QUEUE_PAUSED`/`QUEUE_RESUMED` unconditionally after the write, and the registry cache is only
updated `if (row)` — while `setPaused` throws when `row` is null, so the `if (row)` is dead code
that reads as if null were a tolerated outcome. Minor, but it hides which branch is real.

### 11. `SystemMonitorService` inlines `* 1000`, breaking the seconds invariant

`monitoring/system-monitor.service.ts:108`:

```ts
this.timer = setInterval(() => this.sample(), intervalSeconds * 1000);
```

CLAUDE.md states `util/seconds.ts` is "the **only** place seconds meet milliseconds" and there is
"**no inline `* 1000` anywhere else in the codebase**". This is one. Line 160
(`(now - this.lastSampleAt) * 1000`) is a µs conversion, not a seconds one, so it is arguably
fine — but it should carry a comment saying so.

The same line also hardcodes the default: `this.limiter?.sampleIntervalSeconds ?? 2`, while
`DEFAULT_SAMPLE_INTERVAL_SECONDS = 2` exists in `constants/time.constants.ts` and is **imported
nowhere**. That is the "every default lives in `constants/`, never inline" invariant broken, with
the constant sitting unused right beside it.

Fix: `secondsToMs(this.limiter?.sampleIntervalSeconds ?? DEFAULT_SAMPLE_INTERVAL_SECONDS, 'systemLimiter.sampleIntervalSeconds')`.

### 12. `DEFAULT_BACKOFF_FACTOR` is defined but unused; `computeBackoffSeconds` inlines `2`

`util/backoff.ts:28` — `const factor = input.factor ?? 2;` while
`constants/job.constants.ts:13` exports `DEFAULT_BACKOFF_FACTOR = 2` that nothing imports. Same
invariant as above; two places to change one policy.

### 13. `Wakeup.subscribe` leaks an empty `Set` per queue, and its unsubscribe can resurrect state

`pubsub/wakeup.ts:15` — the returned unsubscribe deletes the callback from the set but never
removes an emptied set from the map. Small, but `signalAll()` then iterates dead entries forever
in a process that declares and tears down queues. Worth a `if (set.size === 0)
this.subscribers.delete(queue)`.

### 14. `run.ts` shuts the client down twice on a failure inside a persistent command

`cli/src/run.ts:41-50`: on success with `persistent`, the client stays alive; on error the
`catch` calls `pq.shutdown()`. A persistent command that throws *after* `listen()` has bound a
port leaves the HTTP server open while the client disconnects — `portqueue dashboard` then serves
503s from a mount whose driver is gone, rather than exiting. `dashboardCommand` also never closes
`dashboard.close()` or the server.

Fix: register a SIGINT/SIGTERM handler in the persistent commands that closes the server, the
dashboard and the client, and exits.

### 15. `--watch` keeps a client alive with an interval that is never cleared

`commands/stats.ts:24-27` sets an interval and then awaits a never-resolving promise; the interval
handle is dropped. Combined with `run.ts` treating `--watch` as persistent, Ctrl-C is the only
exit and nothing shuts the client down cleanly (no `shutdown()`, so in-flight background work and
the driver connection are dropped rather than drained). Same for `listenCommand`.

### 16. `parseArgs` swallows a command that follows a valueless flag

`cli/src/args.ts:26-32`: a `--flag` whose next token does not start with `--` consumes that token
as its value. So `portqueue --json jobs` parses as `{ json: 'jobs' }` with **no command**, and the
CLI prints help instead of listing jobs. The global-flags block in `help.ts` advertises `--json`
and `--no-color` as global, which invites exactly this ordering.

There is no test for the flag-before-command case (`args.test.ts` only covers flags after the
command).

Fix: keep an allowlist of known boolean flags (`json`, `watch`, `yes`, `no-color`, `help`) that
never consume a following token, and add tests for both orderings.

### 17. Dashboard bulk actions across queues are N requests, not one — and partially applied

`JobsTable.tsx:184-195` groups the selection by queue and issues one request **per queue**, each
with its own toast. The action DTO comment says "The server applies them in **one transaction**, so
the batch either lands whole or not at all" — true per request, false for the user's selection. A
failure on the second queue leaves the first queue's jobs already removed, with a success toast
and an error toast side by side.

Also: `runJobBatch` requires a `queue` (`validate.ts:requireQueue`) but never uses it to scope the
driver call — `driver.removeJobs({ jobIds })` matches by id across every queue. So the required
field is validation theatre, and the grouping it forces on the client is what creates the
multi-request split. Either scope the statements by queue name (safer) or drop the requirement and
let one request carry the whole selection.

### 18. `serveAsset` stats the bundle directory on every single request

`dashboard/src/server/assets.ts:91` calls `hasBuiltClient()` — an `fs.stat` — on every asset
request, then `exists(target)` and `readFile`. The bundle cannot appear or disappear at runtime;
this should be resolved once at engine construction (the engine already probes it once at line 57
for the warning) and cached.

### 19. `getJobs` over-fetch trick reports a wrong `total` on the last page

`stats.service.ts:132-141`: the read fetches `limit + 1` rows; when nothing follows,
`total = offset + page.length`. That is correct for a forward walk, but a caller who jumps
straight to a high `offset` (say `offset: 1000` on a 20-row table) gets `total: 1000` — a number
that is not the count of anything. The dashboard's pagination and the CLI's
`… more — use --offset N` hint both read `total`.

Fix: fall back to `countJobs` when `offset > 0 && !hasMore`, or document the semantics as
"total known so far".

### 20. `errorToMessage` truncation can split a multi-byte character

`consumer/completion.service.ts:107` slices by UTF-16 code unit
(`message.slice(0, FAILURE_MESSAGE_MAX_CHARS)`), which can cut a surrogate pair in half and store
a lone surrogate. Some drivers/engines reject that on write (Oracle in particular). Slice on a
code-point boundary.

---

## P3 — improvements

### 21. Test coverage is thin against the size of the surface

206 source files have no sibling test, against CLAUDE.md's "one test file per unit, beside the
unit". The gaps that matter most, roughly in order:

- **`consumer/worker.ts` and `consumer/execution.service.ts` have no test at all.** The claim
  pump, the rate-limiter wakeup, the drain, the lock heartbeat and the abort path are the most
  concurrency-sensitive code in the repo and the most likely home for findings #2 and #3.
- `client/background-work.ts`, `client/instance.service.ts`, `pubsub/*`, `events/event-bus.service.ts`,
  `events/hook-runner.ts`, `retention/retention.service.ts` — none has a sibling test.
- `drivers/shared/base-driver.ts` (`chunkForBind`, `likePattern`, `affinityPlan`) — pure functions,
  trivially testable, currently only exercised indirectly.
- `drivers/shared/migration-runner.service.ts` — the lock-contention and `waitForVersion` paths.
- Dashboard: `server/engine.ts`, `server/request.ts`, and the four adapters (`express`, `koa`,
  `fastify`, `nest`) — the adapters in particular each rewrite `req.url` differently and none is
  tested.
- CLI: `run.ts` covers the happy path; `basic-auth.ts`, `output.ts:table` (ANSI width maths) and
  `commands/dashboard.ts` / `listen.ts` are untested.

### 22. The conformance kit does not cover MySQL or Oracle in CI, and several new methods have no case

Per CLAUDE.md these two are hand-verified. Worth recording in the repo *when* each was last run
against a real server, because nothing else tells a reviewer whether a driver change was
validated. Missing conformance cases for methods that exist:

- `setScheduleEnabled` (the dashboard toggles it; no case)
- `countJobsByStatusPerInstance` (the instance page depends on it)
- `deleteInstance` / `getInstance`
- bind-limit behaviour for the batch methods (finding #4)
- `extendLock` returning false for a lock that lapsed (the heartbeat's abort path depends on it)

### 23. `getSchemaVersion` reads `MAX(version)`, so a partial migration set reads as complete

If `v1` and `v3` applied but `v2` failed, `MAX(version)` is 3 and the runner considers the schema
current. With one version today this is inert, but the array is explicitly designed to grow. Read
the applied set and diff it against `driver.migrations` instead.

### 24. `advisoryKey` truncates a SHA-1 to 48 bits

`postgres-driver.ts:1436-1438` — `hash.readUIntBE(0, 6)`. Fine for the single `migrate` key in
use, but the method is on the `Driver` interface as a general facility; a caller using it for
per-queue or per-job locks would meet birthday collisions sooner than the comment implies. Either
document it as "the migration lock only" or use the full 64-bit signed form Postgres accepts.

### 25. `likePattern` lower-cases in JS but the column is lower-cased in SQL

`base-driver.ts:294` plus `LOWER(col) LIKE ?` at every query site. On Postgres and Oracle this is
correct but unindexable — the `LOWER(...)` call defeats the `created_idx` / name indexes, so a
dashboard search is a sequential scan. Consider a functional index on `LOWER(name)` for the queue
and instance lists (both are declared searchable), or `ILIKE` on Postgres.

### 26. Retention's `LIKE` predicate over `retention_statuses` cannot use an index

`retentionWhere` builds four `OR`ed `col LIKE '%,STATUS,%'` terms. Leading-wildcard `LIKE` is
unindexable on every engine here, and `retention_idx` only covers `(status, retention_ttl_seconds)`.
On a large finished-jobs table each sweep batch scans. Since the encoding is a small fixed set,
a bitmask integer column (or four booleans) would be both indexable and smaller — worth measuring
before changing, since it is a schema change.

### 27. `QueueRegistry.refreshStale` issues one query per stale queue

`producer/queue-registry.ts:154-160` — `Promise.all(stale.map(refresh))`, one `getQueueByName`
each, every tick. A process declaring 50 queues issues 50 queries every 5 s just to read two
booleans. A single `listQueues({ })` filtered to the declared names would be one round trip; the
driver already has `listQueues` and the names are known.

### 28. `SystemMonitorService.start()` is called for every PortQueue in a process

`client-lifecycle.service.ts:90` — always constructs and starts a monitor because "the instance
heartbeat persists these metrics". But a client with **no** `instanceKey` registers no instance
row, so nothing consumes the samples, and the process still pays a `setInterval` +
`cpuUsage()` + `getHeapStatistics()` every 2 s. Skip the monitor when there is neither an
`instanceKey` nor a `systemLimiter`.

### 29. `ProducerService.addJobs` runs `BEFORE_ADD` hooks before validating the batch

`producer.service.ts:122-148` — every entry's `BEFORE_ADD` hook runs, *then* the recurring-entry
check and the mixed-`tx` check throw. A hook with a side effect (the documented use is enriching
options, but nothing enforces purity) has already fired for jobs that will never be inserted.
Validate the batch shape first, then run hooks.

### 30. `addJobs` emits every `JOB_ADDED` before running any `AFTER_ADD` hook

Same file, lines 172-179: two sequential loops. `addJob` (singular) interleaves them the other way
— event, then hook, per job. Not wrong, but the two paths observably differ in ordering for a
caller that listens to both.

### 31. Duplicated `emptyStatusCounts`

Defined twice: `drivers/shared/base-driver.ts:299` (protected) and
`monitoring/stats.service.ts:39` (exported). Same body. One should import the other.

### 32. `DASHBOARD_MAX_LIMIT` is an alias of `DASHBOARD_MAX_PAGE_LIMIT`

`dashboard/dashboard-results.ts:21` re-exports the constant under a second name, and both are
public from the barrel (`export * from './constants'` plus the explicit export). Two spellings of
one setting — the invariant CLAUDE.md calls out by name. Pick one.

### 33. `_dashboard.getJobs` hardcodes `50` where `DEFAULT_PAGE_LIMIT` exists

`dashboard.service.ts:211` — `Math.trunc(base.limit ?? 50)`. Same inline-default issue as #11.

### 34. `readBody`'s 1 MB cap is a bare literal, and rejects without draining

`dashboard/src/server/request.ts:5` — `MAX_BODY_BYTES` is defined in that file rather than in a
shared constants module, and on overflow it calls `req.destroy()` mid-stream, which on
HTTP/1.1 keep-alive closes the connection rather than returning a clean 413 the client can read.
The 413 is written by the caller, but the socket may already be gone.

### 35. `owns()` matches `basePath` as a raw prefix

`engine.ts:67-71` — `path === basePath || path.startsWith(basePath + '/') || path.startsWith(basePath + '?')`.
The third clause is dead: `path` has already had its query string removed at line 69
(`url.split('?')[0]`), so it can never contain `?`.

### 36. CLI `--limit`/`--offset` treat `0` as "unset"

`commands/jobs.ts:23-24`, `queues.ts:15-16`, `instances.ts:42-43` all use
`...(limit ? { limit } : {})`. `--offset 0` is indistinguishable from omitting it (harmless) but
`--limit 0` silently becomes the default 50 rather than erroring. Use `!== undefined`.

### 37. CLI has no way to page schedules

`commands/schedules.ts` calls `pq._cli.getSchedules({ queue })` and never passes `limit`/`offset`,
though the facade accepts both — and unlike `jobs`/`queues`/`instances`, it prints no
"… more — use --offset N" hint. A deployment with more than 50 schedules cannot see the rest.

### 38. CLI `retry`/`cancel`/`remove` each do a read before the write

`retry.ts:14`, `cancel.ts:14`, `remove.ts:21` all `getJob` first purely to produce a "not found"
message, then act. The driver methods already return `null`/`false` for an unknown id, so this is
an extra round trip per command that also opens a TOCTOU window (the job can change status
between the read and the write, making the error message wrong).

### 39. `errorToMessage` stores full stacks by default

Capped at 4 000 chars, but a busy queue with a failing handler still writes ~4 KB per failed row.
Worth a queue-level option to store `message` only, or a shorter default.

### 40. `docs/` needs a pass once the above land

Several findings change documented behaviour: the CSRF header's actual role (#1), what `cancelJob`
returns (#3), migration atomicity on MySQL/Oracle (#6), the multi-instance migration caveat (#7),
idempotency being best-effort under concurrency (#9), and any new `GetQueuesQuery` fields (#5).
Per CLAUDE.md, each of those needs the API reference, the dashboard/CLI pages and
`docs/sidebars.ts` checked.

---

## Suggested order

1. **#1** (CSRF) — smallest fix, largest exposure.
2. **#2 + #3** (lock release on shutdown, cancel semantics) — write the worker/execution tests
   from #21 first; they are the same work.
3. **#4** (bind-limit chunking) — mechanical, and reachable from the UI today.
4. **#6, #7, #9** — decide whether each is a fix or a documented limitation, then do that.
5. **#8, #16, #17** — user-visible wrongness with contained fixes.
6. The rest as capacity allows.
