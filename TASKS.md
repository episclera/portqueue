# TASKS — audit findings

A review of `@portqueue/core`, `@portqueue/dashboard` and `@portqueue/cli` as of 2026-07-31
(branch `main`, commit `763038e`). **All 40 findings are addressed** as of 2026-08-01; what follows is
the record of how, kept because several of the fixes are decisions rather than repairs and the
reasoning is worth having next to the finding that prompted it.

Baseline at the time of the audit: `npm test` → 17 suites, 165 tests. Now: 58 suites, 594 tests.

---

## P1 — correctness and security

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

### 5. `getQueue`/`getQueues` counts could disagree with the page on a large queue list

**Fixed.** `search` and `processingPaused` are on the public `GetQueuesQuery` (and `search` /
`processingPaused` / `alive` on `GetInstancesQuery`), applied in SQL, with the same filter passed to
the page and its `COUNT`. The dashboard facade now delegates to those reads instead of keeping a
second copy of the same driver calls; it only tightens the page ceiling.

---

## P2 — defects and unkept guarantees

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

### 39. `errorToMessage` stored full stacks by default

**Fixed** — `createQueue({ failureDetail: FailureDetail.MESSAGE })` drops the frames for a queue that
fails often; the default stays `STACK`.

