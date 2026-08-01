# TASKS — audit findings

A review of `@portqueue/core`, `@portqueue/dashboard` and `@portqueue/cli` as of 2026-07-31
(branch `main`, commit `763038e`). **All 40 findings are addressed** as of 2026-08-01; what follows is
the record of how, kept because several of the fixes are decisions rather than repairs and the
reasoning is worth having next to the finding that prompted it.

Baseline at the time of the audit: `npm test` → 17 suites, 165 tests. Now: 58 suites, 594 tests.

---

## P1 — correctness and security

### 1. The dashboard's mutation endpoint had no CSRF defence, despite shipping the header for one

**Fixed.** `assertSameOrigin` in `routes/index.ts` refuses any non-GET without
`x-requested-with: portqueue-dashboard`, before the request reaches the database or the body is
parsed. A browser cannot set a custom header cross-origin without a preflight the mount never answers,
so a form post or simple `fetch` from another page is rejected — which is what matters, because the
host's auth middleware is exactly what replays cookies and Basic credentials.

Each mutation also got **its own endpoint**: `POST /api/actions/<ActionKind>`, dispatched by the URL
segment. `kind` left the request body (`ActionPayloadDto` is the body; `ActionRequestDto` is what the
client's `api.action` takes and splits). No new `createDashboard` option — protecting the mount is
still the host's middleware's job.

### 2. `Worker.stop()` released the lock of a job that was about to complete normally

**Fixed, both ways the finding asked for.**

`Worker.abortAndRelease` aborts every handler, waits `ABORT_GRACE_SECONDS`, and releases the lock only
of the handlers still running — so a handler that observes `job.signal` settles its own row and a
straggler's job becomes reclaimable at once.

The guard is a **fence token**, not a status check: `v1` gained a `lock_token` column, every claim
stamps a fresh one, and `completeJob`/`failJob`/`retryJob`/`extendLock` are guarded on it in all four
drivers and now **return whether the row was settled**. `status = ACTIVE` alone is not a fence — a
lapsed lock is reclaimed, the row is claimed again and reads `ACTIVE` once more. A refused settle
raises `LockLostError` on the `ERROR` event and emits no lifecycle event.

Conformance: a fresh token per claim, a late `completeJob` refused rather than overwriting the
re-claim, `failJob`/`retryJob` likewise, and `extendLock` false once the claim is gone.

### 3. `PortQueue.cancelJob` reported success without settling the row

**Fixed.** Returns `CancelOutcome` — `CANCELLED`, `SIGNALLED` or `NOT_CANCELLABLE` — and throws
`JobNotFoundError` for an id that names no row (one read, only on the refusal path). The dashboard's
CANCEL batch counts signalled jobs in `signalled` rather than `affected`, emits **no** `JOB_CANCELLED`
for them, and the toast says "… 2 running jobs were asked to stop."

### 4. Batch id methods bypassed `chunkForBind`, so a large batch exceeded the bind-parameter limit

**Fixed, with a cap as well as chunking.** `MAX_BATCH_IDS = 1000` — Oracle's `IN`-list ceiling, taken
as everyone's — is enforced by `assertBatchIds` on every public id-taking method, so a batch cannot
work on Postgres and raise ORA-01795 on Oracle. Underneath, `BaseDriver.chunkIds`/`overIdChunks` split
any id list by `maxInListItems` *and* the bind budget; `removeJobs`, `cancelJobs`, `requeueJobs`,
`deleteSchedules` and the grouped counts all go through it in all four drivers. The dashboard's tables
stop a selection past the cap with a tooltip. Every plural method issues plural SQL — the delegation
runs singular → plural, never the other way. Conformance covers a batch at the cap and past it.

### 5. `getQueue`/`getQueues` counts could disagree with the page on a large queue list

**Fixed.** `search` and `processingPaused` are on the public `GetQueuesQuery` (and `search` /
`processingPaused` / `alive` on `GetInstancesQuery`), applied in SQL, with the same filter passed to
the page and its `COUNT`. The dashboard facade now delegates to those reads instead of keeping a
second copy of the same driver calls; it only tightens the page ceiling.

---

## P2 — defects and unkept guarantees

### 6. `applyMigration` is **not** atomic on MySQL or Oracle

**Documented as the engine constraint it is, and made detectable.** DDL commits implicitly on both, so
no transaction can span the statements and the version insert. The drivers run the DDL first (a
version recorded for statements that never ran would be worse), the `MigrationStep` contract now
requires idempotent statements, and the runner **reads the version back before attempting the next
step** — so a step that ran without being recorded is an error rather than something carried forward.
Stated in `Driver.applyMigration`, both driver classes, and the driver-author docs.

### 7. Migration lock was Postgres-only, so a concurrent first boot raced on every other engine

**Fixed for MySQL; documented for the rest.** MySQL has a real named lock, so `MysqlDriver` implements
`tryAdvisoryLock`/`releaseAdvisoryLock` with `GET_LOCK` on a held connection and declares
`ADVISORY_LOCK`. SQLite and PGLite serialize writers by construction. Oracle has no portable
equivalent, so the runner proceeds without one (safe for idempotent DDL), logs that it did, and the
docs recommend `portqueue migrate` before starting a multi-instance Oracle deployment.

Found on the way: Postgres' advisory lock was taken and released on *pooled* connections, so the
release landed on whichever connection came out next. Both drivers now hold the connection for the
lock's lifetime and drop it on `disconnect`.

### 8. `requeueJobs` left `retried_at`/`stalled_at` set

**Fixed** in all four drivers, along with `lock_token`, plus a conformance case asserting a requeued
job carries no marker of its previous life.

### 9. `insertJobs` dedup was a read-then-write with no uniqueness backstop

**Fixed by locking, not by a constraint.** A batch carrying an `idempotencyKey` or `singletonKey`
takes a row lock on the queue row before the lookup — the lock every other producer on that queue must
also take — so two concurrent adds of one key can no longer both insert. SQLite needs none
(`BEGIN IMMEDIATE` holds the database-wide write lock) and says so at the call site. Still no unique
index: singleton dedup is scoped to the statuses holding the slot, which no portable constraint
expresses, and a dedup must return the existing job rather than raise. Two conformance cases run
concurrent identical adds.

### 10. `pauseQueue`'s dead `if (row)` branch

**Fixed.** `setPaused` returns `QueueRow` (it throws when nothing matched), so the cache update and the
event both describe a write that happened.

### 11. `SystemMonitorService` inlined `* 1000`

**Fixed everywhere.** The monitor uses
`secondsToMs(… ?? DEFAULT_SAMPLE_INTERVAL_SECONDS, 'systemLimiter.sampleIntervalSeconds')`. Every other
inline conversion in the repo went too: `util/seconds` now exports `MS_PER_SECOND` and the converters
are exported from the core barrel, so the CLI's `--watch` interval and `relativeTime` use them. The
µs conversion is named `MICROS_PER_MS` and says why it is not the seconds boundary. The per-row
`retention_ttl_seconds * 1000` in each driver's SQL is the one multiplication that cannot move to JS
(the value is a column) and now interpolates the named constant.

### 12. `DEFAULT_BACKOFF_FACTOR` was defined but unused

**Fixed**, along with `DEFAULT_SAMPLE_INTERVAL_SECONDS` and the inline `50` in `_dashboard.getJobs`
(#33). CLAUDE.md now states that `constants/` is the source of truth and that a constant which exists
must be used.

### 13. `Wakeup.subscribe` leaked an empty `Set` per queue

**Fixed**, including the resubscribe hazard the naive fix would have introduced (the entry is only
dropped if it is still the same set). `pubsub/wakeup.test.ts` covers both.

### 14. `run.ts` shut the client down twice on a failure inside a persistent command

**Fixed.** Commands register teardowns via `CommandContext.onExit`; the runner closes them
newest-first and then the client, exactly once, on a clean exit, a throw, or `SIGINT`/`SIGTERM`.
`dashboard` registers the server and the mount; `listen` its subscriptions.

### 15. `--watch` kept a client alive with an interval that was never cleared

**Fixed** — `stats --watch` hands its interval to `onExit`, and the signal handler drains the client.

### 16. `parseArgs` swallowed a command that followed a valueless flag

**Fixed** with a `BOOLEAN_FLAGS` allowlist, and tested in both orderings.

### 17. Dashboard bulk actions across queues were N requests, partially applied

**Fixed.** One request carries the whole selection: `queue` left the job-batch actions entirely (an id
identifies its row, and the driver's ref names the row's own queue), so there is nothing left to group
by and one toast summarizes the result.

### 18. `serveAsset` stat'd the bundle directory on every request

**Fixed** — `hasBuiltClient()` memoizes the promise; the mount-time warning primes it.

### 19. `getJobs`' over-fetch trick reported a wrong `total` on the last page

**Fixed** — `total` is always a `COUNT` over the same predicate as the page.

### 20. `errorToMessage` truncation could split a multi-byte character

**Fixed** — the cut backs off a trailing high surrogate.

---

## P3 — improvements

### 21. Test coverage was thin against the size of the surface

165 → 594 tests. New sibling suites for `consumer/worker` (the drain, the abort, the release — the
home of #2 and #3), `pubsub/wakeup`, `drivers/shared/base-driver` (chunking, escaping, affinity
arithmetic), `drivers/shared/migration-runner` (ordering, the lock, the read-back), the dashboard's
`engine` and `request`, the CLI's `basic-auth`, and `output.ts:table`'s ANSI width maths.

The **adapter tests** are the ones that earned their keep: driven through real Express, Koa and
Fastify (`express`, `koa`, `fastify` are now dev dependencies), they found two genuine bugs — the
Fastify plugin was encapsulated, so every dashboard URL fell through to Fastify's 404, and its hook
never signalled completion, so a request that reached it hung.

### 22. The conformance kit did not cover MySQL or Oracle in CI, and several methods had no case

**Both addressed.** `src/conformance/manual.test.ts` runs the kit against a live MySQL or Oracle from
environment variables and skips an engine that has none; `npm run test:mysql` / `npm run test:oracle`
pass the dev-compose credentials. `packages/core/DRIVER-VERIFICATION.md` records when each was last
run — **both are pending**, and this changeset touched both drivers materially. Missing cases added:
`setScheduleEnabled`, `countJobsByStatusPerInstance`, `getInstance`/`deleteInstance`, the bind-limit
behaviour, and `extendLock` returning false for a lapsed claim.

### 23. `getSchemaVersion` read `MAX(version)`, so a partial set read as complete

**Fixed by making the maximum truthful**: versions apply in ascending order and each is confirmed
recorded before the next is attempted, so the applied set is always a contiguous prefix.

### 24. `advisoryKey` truncated a SHA-1 to 48 bits

**Documented as the constraint it is.** 48 bits is the widest that survives a round trip through a JS
`number`, which is what the parameter is bound as; the doc names the keys in use (one) and points at
the collision arithmetic for a caller taking more.

### 25. `likePattern` lower-cased in JS but the column was lower-cased in SQL

**Resolved.** Postgres/PGLite use `ILIKE`, dropping a per-row `LOWER()` call. No index was added:
a leading-wildcard `LIKE` is unindexable on every engine here — a functional `LOWER(name)` index would
not serve it either — so the honest answer is the `LIMIT`, and `likePattern` now says so.

### 26. Retention's `LIKE` over `retention_statuses` could not use an index

**Fixed with the bitmask the finding suggested.** `retention_statuses` is an integer, tested with `&`
(`BITAND` on Oracle): one integer comparison per candidate row instead of four `OR`ed leading-wildcard
`LIKE`s, in a fraction of the bytes. `FINISHED_STATUSES` order is now part of the stored format, and
`retention-statuses.ts` says a status may be appended but never reordered.

### 27. `QueueRegistry.refreshStale` issued one query per stale queue

**Fixed** — one `listQueues()` per tick, whatever the declaration count.

### 28. `SystemMonitorService.start()` ran for every PortQueue in a process

**Fixed** — only started when an `instanceKey` or a `systemLimiter` means something reads the samples.

### 29. `addJobs` ran `BEFORE_ADD` hooks before validating the batch

**Fixed** — `validateBatch` runs first; the shape is re-checked on what each hook returned.

### 30. `addJobs` emitted every `JOB_ADDED` before running any `AFTER_ADD` hook

**Fixed** — event then hook, per job, matching `addJob`.

### 31. Duplicated `emptyStatusCounts`

**Fixed** — one definition, beside the `JobStatus` enum whose shape it is.

### 32. `DASHBOARD_MAX_LIMIT` was an alias of `DASHBOARD_MAX_PAGE_LIMIT`

**Fixed** — the alias is gone; `DASHBOARD_MAX_PAGE_LIMIT` is the name.

### 33. `_dashboard.getJobs` hardcoded `50`

**Fixed** — `DEFAULT_PAGE_LIMIT`.

### 34. `readBody`'s 1 MB cap was a bare literal, and rejected without draining

**Fixed** — `MAX_BODY_BYTES` lives in `shared/constants` (it is a property of the API the client
talks to), and an oversized body is drained and discarded before the reader rejects, so the caller's
413 reaches a connection that is still open.

### 35. `owns()` matched `basePath` as a raw prefix

**Fixed** — the dead `?` clause is gone, and `engine.test.ts` pins that `/portqueue-admin` is not ours.

### 36. CLI `--limit`/`--offset` treated `0` as "unset"

**Fixed** — a shared `pageFlags` helper tests `!== undefined` and rejects a limit below 1.

### 37. CLI had no way to page schedules

**Fixed** — `schedules` takes `--limit`/`--offset` and prints the same "… more" hint as every other
paged list, from a shared `printMoreHint`.

### 38. CLI `retry`/`cancel`/`remove` each did a read before the write

**Fixed** — they act first and read only to explain a refusal, which also closes the TOCTOU window
that made the message name a state the job was no longer in.

### 39. `errorToMessage` stored full stacks by default

**Fixed** — `createQueue({ failureDetail: FailureDetail.MESSAGE })` drops the frames for a queue that
fails often; the default stays `STACK`.

### 40. `docs/` needed a pass

**Done** — the API reference covers the `CancelOutcome`, the promoted query filters, `failureDetail`,
the batch cap and the new errors; `advanced.md` carries the driver-author contract for the claim fence,
the migration/lock semantics and the dedup lock; the dashboard page gains a short note on what the
`x-requested-with` requirement does and does not do.
